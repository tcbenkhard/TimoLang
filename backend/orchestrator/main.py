from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from orchestrator.config import Settings, get_settings
from orchestrator.domain import (
    DesignProviderConfig,
    DesignProviderName,
    DesignProviderView,
    DesignReview,
    GitHubAccountConfig,
    GitHubAccountView,
    PullRequestUpdate,
    WorkflowCreate,
)
from orchestrator.providers.design_cli import CliDesignProvider
from orchestrator.providers.development_cli import CliDevelopmentProvider
from orchestrator.providers.github import GitHubRepositoryAccess
from orchestrator.repository import WorkflowRepository
from orchestrator.service import InvalidTransitionError, WorkflowNotFoundError, WorkflowService
from orchestrator.workflow import build_workflow


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        open=False,
    )
    await pool.open()
    async with pool.connection() as connection:
        await WorkflowRepository(connection).setup()
    checkpointer = AsyncPostgresSaver(cast(Any, pool))
    await checkpointer.setup()
    app.state.pool = pool
    repository_access = GitHubRepositoryAccess(pool, settings.workspace_root)
    design_provider = CliDesignProvider(pool, settings.design_generation_timeout_seconds)
    development_provider = CliDevelopmentProvider(
        pool,
        settings.workspace_root,
        settings.implementation_timeout_seconds,
    )
    app.state.service = WorkflowService(
        pool,
        build_workflow(
            checkpointer,
            design_generation=design_provider.generate,
            implementation=development_provider.implement,
            code_review=development_provider.review,
            pull_request_preparation=development_provider.prepare_pull_request,
            repository_access=repository_access.resolve_and_inspect,
        ),
        checkpointer,
        settings.workspace_root,
    )
    yield
    await pool.close()


app = FastAPI(title="Engineering Orchestrator API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def inspect_key_path(value: str) -> tuple[Path, bool]:
    path = Path(value).expanduser().resolve()
    supported = path.suffix.lower() in {"", ".pem", ".key", ".priv"}
    return path, path.is_file() and supported


def choose_ssh_private_key() -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as error:
        raise RuntimeError("Native file browsing requires Python tkinter") from error

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        selected = filedialog.askopenfilename(
            parent=root,
            title="Select an OpenSSH private key",
            initialdir=str(Path.home()),
            filetypes=[
                ("OpenSSH private keys", "id_* *.pem *.key *.priv"),
                ("Extensionless private keys", "*"),
            ],
        )
        return selected or None
    finally:
        root.destroy()


def require_auth(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    expected = f"Bearer {settings.api_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")


def service(request: Request) -> WorkflowService:
    return cast(WorkflowService, request.app.state.service)


def translate_error(error: Exception) -> HTTPException:
    if isinstance(error, WorkflowNotFoundError):
        return HTTPException(status_code=404, detail="Workflow not found")
    if isinstance(error, InvalidTransitionError):
        return HTTPException(status_code=409, detail=str(error))
    return HTTPException(status_code=500, detail="Workflow operation failed")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/settings/github-accounts", dependencies=[Depends(require_auth)])
async def list_github_accounts(request: Request) -> list[GitHubAccountView]:
    async with request.app.state.pool.connection() as connection:
        rows = await WorkflowRepository(connection).list_github_accounts()
    result = []
    for row in rows:
        _, available = await asyncio.to_thread(inspect_key_path, row["ssh_key_path"])
        result.append(
            GitHubAccountView(
                account=row["account"],
                ssh_key_path=row["ssh_key_path"],
                key_available=available,
            )
        )
    return result


@app.post("/api/settings/browse-ssh-key", dependencies=[Depends(require_auth)])
async def browse_ssh_key() -> dict[str, str | None]:
    try:
        selected = await asyncio.to_thread(choose_ssh_private_key)
    except RuntimeError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    if selected:
        path, available = await asyncio.to_thread(inspect_key_path, selected)
        if not available:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Select an OpenSSH private key without an extension or with "
                    ".pem, .key, or .priv"
                ),
            )
        return {"path": str(path)}
    return {"path": None}


@app.put("/api/settings/github-accounts/{account}", dependencies=[Depends(require_auth)])
async def configure_github_account(
    account: str, body: GitHubAccountConfig, request: Request
) -> GitHubAccountView:
    if account.lower() != body.account.lower():
        raise HTTPException(status_code=400, detail="Account path and body must match")
    key_path, available = await asyncio.to_thread(inspect_key_path, body.ssh_key_path)
    if not available:
        raise HTTPException(
            status_code=422,
            detail=(
                "SSH private key must exist and have no extension or use .pem, .key, or .priv; "
                ".pub and PuTTY .ppk files are not accepted"
            ),
        )
    async with request.app.state.pool.connection() as connection:
        await WorkflowRepository(connection).upsert_github_account(account, str(key_path))
    return GitHubAccountView(
        account=account.lower(), ssh_key_path=str(key_path), key_available=True
    )


@app.delete("/api/settings/github-accounts/{account}", dependencies=[Depends(require_auth)])
async def delete_github_account(account: str, request: Request) -> dict[str, str]:
    async with request.app.state.pool.connection() as connection:
        await WorkflowRepository(connection).delete_github_account(account)
    return {"status": "deleted"}


@app.get(
    "/api/settings/design-provider",
    dependencies=[Depends(require_auth)],
)
async def get_design_provider(request: Request) -> DesignProviderView:
    async with request.app.state.pool.connection() as connection:
        selected = await WorkflowRepository(connection).get_setting(
            "design_provider", DesignProviderName.CODEX
        )
    return DesignProviderView(
        provider=DesignProviderName(selected),
        availability={
            provider: shutil.which(provider.command) is not None
            for provider in DesignProviderName
        },
    )


@app.put(
    "/api/settings/design-provider",
    dependencies=[Depends(require_auth)],
)
async def set_design_provider(
    body: DesignProviderConfig, request: Request
) -> DesignProviderView:
    async with request.app.state.pool.connection() as connection:
        await WorkflowRepository(connection).set_setting("design_provider", body.provider)
    return DesignProviderView(
        provider=body.provider,
        availability={
            provider: shutil.which(provider.command) is not None
            for provider in DesignProviderName
        },
    )


@app.post("/api/workflows", status_code=202, dependencies=[Depends(require_auth)])
async def create_workflow(
    body: WorkflowCreate, workflow_service: WorkflowService = Depends(service)
) -> dict[str, str]:
    workflow_id = await workflow_service.create(body)
    return {"id": str(workflow_id)}


@app.get("/api/workflows", dependencies=[Depends(require_auth)])
async def list_workflows(workflow_service: WorkflowService = Depends(service)) -> object:
    return await workflow_service.list()


@app.get("/api/workflows/{workflow_id}", dependencies=[Depends(require_auth)])
async def get_workflow(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> object:
    try:
        return await workflow_service.get(workflow_id)
    except WorkflowNotFoundError as error:
        raise translate_error(error) from error


@app.post("/api/workflows/{workflow_id}/design-review", dependencies=[Depends(require_auth)])
async def review_design(
    workflow_id: UUID,
    body: DesignReview,
    workflow_service: WorkflowService = Depends(service),
) -> dict[str, str]:
    try:
        await workflow_service.review_design(workflow_id, body)
        return {"status": "accepted"}
    except (WorkflowNotFoundError, InvalidTransitionError) as error:
        raise translate_error(error) from error


@app.post("/api/workflows/{workflow_id}/pull-request", dependencies=[Depends(require_auth)])
async def update_pull_request(
    workflow_id: UUID,
    body: PullRequestUpdate,
    workflow_service: WorkflowService = Depends(service),
) -> dict[str, str]:
    try:
        await workflow_service.update_pull_request(workflow_id, body)
        return {"status": "accepted"}
    except (WorkflowNotFoundError, InvalidTransitionError) as error:
        raise translate_error(error) from error


@app.post("/api/workflows/{workflow_id}/cancel", dependencies=[Depends(require_auth)])
async def cancel_workflow(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> dict[str, str]:
    try:
        await workflow_service.cancel(workflow_id)
        return {"status": "cancelled"}
    except WorkflowNotFoundError as error:
        raise translate_error(error) from error


@app.post(
    "/api/workflows/{workflow_id}/restart", status_code=202, dependencies=[Depends(require_auth)]
)
async def restart_workflow(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> dict[str, str]:
    try:
        restarted_id = await workflow_service.restart(workflow_id)
        return {"id": str(restarted_id)}
    except (WorkflowNotFoundError, InvalidTransitionError) as error:
        raise translate_error(error) from error


@app.post(
    "/api/workflows/{workflow_id}/retry", status_code=202, dependencies=[Depends(require_auth)]
)
async def retry_workflow(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> dict[str, str]:
    try:
        await workflow_service.retry(workflow_id)
        return {"status": "retrying"}
    except (WorkflowNotFoundError, InvalidTransitionError) as error:
        raise translate_error(error) from error


@app.delete("/api/workflows/{workflow_id}", status_code=204, dependencies=[Depends(require_auth)])
async def delete_workflow(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> None:
    try:
        await workflow_service.delete(workflow_id)
    except WorkflowNotFoundError as error:
        raise translate_error(error) from error


@app.get("/api/workflows/{workflow_id}/events", dependencies=[Depends(require_auth)])
async def workflow_events(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        last_event = ""
        while True:
            detail = await workflow_service.get(workflow_id)
            payload = detail.model_dump(mode="json")
            encoded = json.dumps(payload)
            if encoded != last_event:
                yield f"event: workflow\ndata: {encoded}\n\n"
                last_event = encoded
            yield ": heartbeat\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/api/workflows/{workflow_id}/reports", dependencies=[Depends(require_auth)])
async def workflow_reports(
    workflow_id: UUID, workflow_service: WorkflowService = Depends(service)
) -> dict[str, object]:
    detail = await workflow_service.get(workflow_id)
    return {
        "designs": detail.designs,
        "final_report": detail.state.get("final_report"),
    }


@app.post("/api/webhooks/github", status_code=202)
async def github_webhook(
    request: Request,
    x_hub_signature_256: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    body = await request.body()
    expected = (
        "sha256=" + hmac.new(settings.webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    )
    if not x_hub_signature_256 or not hmac.compare_digest(x_hub_signature_256, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    return {"status": "accepted"}

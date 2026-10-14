from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from langgraph.types import Command
from psycopg_pool import AsyncConnectionPool

from orchestrator.domain import (
    DesignReview,
    DesignVersion,
    PullRequestUpdate,
    WorkflowCreate,
    WorkflowEvent,
    WorkflowPhase,
)
from orchestrator.repository import WorkflowRepository


class WorkflowNotFoundError(Exception):
    pass


class InvalidTransitionError(Exception):
    pass


def remove_workspace(workspace: Path) -> None:
    if workspace.is_dir():
        shutil.rmtree(workspace)


def describe_error(error: BaseException) -> str:
    message = str(error).strip()
    error_type = type(error).__name__
    return f"{error_type}: {message}" if message else error_type


def retry_phase_for_node(node: str) -> WorkflowPhase:
    phases = {
        "ingest_ticket": WorkflowPhase.INGESTING,
        "resolve_repository": WorkflowPhase.INGESTING,
        "design_solution": WorkflowPhase.DESIGNING,
        "implement_solution": WorkflowPhase.DEVELOPING,
        "review_solution": WorkflowPhase.REVIEWING,
        "correct_review_findings": WorkflowPhase.REVIEWING,
        "implement_pr_feedback": WorkflowPhase.DEVELOPING,
        "prepare_pull_request": WorkflowPhase.DEVELOPING,
        "generate_final_report": WorkflowPhase.REPORTING,
    }
    try:
        return phases[node]
    except KeyError as error:
        raise InvalidTransitionError(
            f"The failed workflow step '{node}' cannot be retried"
        ) from error


class WorkflowService:
    def __init__(
        self, pool: AsyncConnectionPool[Any], graph: Any, checkpointer: Any, workspace_root: Path
    ) -> None:
        self.pool = pool
        self.graph = graph
        self.checkpointer = checkpointer
        self.workspace_root = workspace_root.resolve()
        self._locks: dict[UUID, asyncio.Lock] = {}

    async def create(self, request: WorkflowCreate) -> UUID:
        workflow_id = uuid4()
        source_url = request.source_url
        initial_input = request.model_dump(mode="json", exclude_none=True)
        async with self.pool.connection() as connection:
            repository = WorkflowRepository(connection)
            await repository.create(
                workflow_id,
                source_url,
                request.mock_scenario.model_dump(mode="json"),
                initial_input,
            )
            await repository.add_event(
                WorkflowEvent(
                    workflow_id=workflow_id,
                    kind="workflow.created",
                    message=(
                        f"Test workflow created for {request.test_id}"
                        if request.test_id
                        else (
                            "Workflow created from user-provided text"
                            if request.request_text
                            else "Workflow created from Wrike URL"
                        )
                    ),
                    phase=WorkflowPhase.INGESTING,
                    data={"source_kind": request.source_kind, "project": request.project},
                )
            )
        asyncio.create_task(
            self._run_safely(
                workflow_id,
                {
                    "workflow_id": str(workflow_id),
                    "execution_id": uuid4().hex[:8],
                    "wrike_url": source_url,
                    "source_kind": request.source_kind,
                    "request_text": request.request_text,
                    "requested_project": request.project,
                    "scenario": request.mock_scenario.model_dump(mode="json"),
                    "phase": WorkflowPhase.INGESTING,
                },
            )
        )
        return workflow_id

    async def restart(self, workflow_id: UUID) -> UUID:
        lock = self._locks.setdefault(workflow_id, asyncio.Lock())
        async with lock:
            async with self.pool.connection() as connection:
                repository = WorkflowRepository(connection)
                initial_input = await repository.get_initial_input(workflow_id)
                if initial_input is None:
                    raise WorkflowNotFoundError(str(workflow_id))
                if not initial_input:
                    raise InvalidTransitionError(
                        "This workflow predates restart metadata and cannot be restarted "
                        "automatically"
                    )
                request = WorkflowCreate.model_validate(initial_input)

            await self.checkpointer.adelete_thread(str(workflow_id))
            workspace = (self.workspace_root / str(workflow_id)).resolve()
            if self.workspace_root in workspace.parents:
                await asyncio.to_thread(remove_workspace, workspace)

            async with self.pool.connection() as connection:
                repository = WorkflowRepository(connection)
                await repository.reset(
                    workflow_id, request.mock_scenario.model_dump(mode="json")
                )
                await repository.add_event(
                    WorkflowEvent(
                        workflow_id=workflow_id,
                        kind="workflow.restarted",
                        message="Workflow restarted from its original input",
                        phase=WorkflowPhase.INGESTING,
                        data={"source_kind": request.source_kind, "project": request.project},
                    )
                )

        asyncio.create_task(
            self._run_safely(
                workflow_id,
                {
                    "workflow_id": str(workflow_id),
                    "execution_id": uuid4().hex[:8],
                    "wrike_url": request.source_url,
                    "source_kind": request.source_kind,
                    "request_text": request.request_text,
                    "requested_project": request.project,
                    "scenario": request.mock_scenario.model_dump(mode="json"),
                    "phase": WorkflowPhase.INGESTING,
                },
            )
        )
        return workflow_id

    async def retry(self, workflow_id: UUID) -> None:
        lock = self._locks.setdefault(workflow_id, asyncio.Lock())
        async with lock:
            detail = await self.get(workflow_id)
            if detail.phase != WorkflowPhase.FAILED:
                raise InvalidTransitionError("Only a failed workflow step can be retried")

            config = {"configurable": {"thread_id": str(workflow_id)}}
            snapshot = await self.graph.aget_state(config)
            pending = tuple(snapshot.next)
            if len(pending) != 1:
                raise InvalidTransitionError(
                    "The failed workflow does not have exactly one retryable pending step"
                )
            node = pending[0]
            phase = retry_phase_for_node(node)
            async with self.pool.connection() as connection:
                repository = WorkflowRepository(connection)
                await repository.update(workflow_id, phase=phase, error=None)
                await repository.add_event(
                    WorkflowEvent(
                        workflow_id=workflow_id,
                        kind="workflow.retry",
                        message=f"Retrying failed step: {node.replace('_', ' ')}",
                        phase=phase,
                        data={"node": node},
                    )
                )

        asyncio.create_task(self._run_safely(workflow_id, None))

    async def delete(self, workflow_id: UUID) -> None:
        await self.get(workflow_id)
        lock = self._locks.setdefault(workflow_id, asyncio.Lock())
        async with lock:
            await self.checkpointer.adelete_thread(str(workflow_id))
            async with self.pool.connection() as connection:
                await WorkflowRepository(connection).delete(workflow_id)
            workspace = (self.workspace_root / str(workflow_id)).resolve()
            if self.workspace_root in workspace.parents:
                await asyncio.to_thread(remove_workspace, workspace)
            self._locks.pop(workflow_id, None)

    async def _run_safely(self, workflow_id: UUID, input_value: Any) -> None:
        try:
            await self._run(workflow_id, input_value)
        except Exception:
            # _run persists the diagnostic event; background execution has no awaiting caller.
            return

    async def review_design(self, workflow_id: UUID, review: DesignReview) -> None:
        detail = await self.get(workflow_id)
        if detail.phase != WorkflowPhase.AWAITING_DESIGN_APPROVAL:
            raise InvalidTransitionError("Workflow is not awaiting design approval")
        if review.action == "approve":
            async with self.pool.connection() as connection:
                repository = WorkflowRepository(connection)
                await repository.update(
                    workflow_id,
                    phase=WorkflowPhase.DEVELOPING,
                    approved_version=detail.current_design_version,
                )
                await repository.add_event(
                    WorkflowEvent(
                        workflow_id=workflow_id,
                        kind="workflow.transition",
                        message="Design approved; implementation started",
                        phase=WorkflowPhase.DEVELOPING,
                        data={"design_version": detail.current_design_version},
                    )
                )
            asyncio.create_task(
                self._run_safely(
                    workflow_id, Command(resume=review.model_dump(mode="json"))
                )
            )
            return
        await self._run(workflow_id, Command(resume=review.model_dump(mode="json")))

    async def update_pull_request(self, workflow_id: UUID, update: PullRequestUpdate) -> None:
        detail = await self.get(workflow_id)
        if detail.phase != WorkflowPhase.AWAITING_PR_MERGE:
            raise InvalidTransitionError("Workflow is not awaiting a pull request merge")
        await self._run(workflow_id, Command(resume=update.model_dump(mode="json")))

    async def cancel(self, workflow_id: UUID) -> None:
        await self.get(workflow_id)
        async with self.pool.connection() as connection:
            repository = WorkflowRepository(connection)
            await repository.update(workflow_id, phase=WorkflowPhase.CANCELLED)
            await repository.add_event(
                WorkflowEvent(
                    workflow_id=workflow_id,
                    kind="workflow.cancelled",
                    message="Workflow cancelled by user",
                    phase=WorkflowPhase.CANCELLED,
                )
            )

    async def list(self) -> Any:
        async with self.pool.connection() as connection:
            return await WorkflowRepository(connection).list_workflows()

    async def get(self, workflow_id: UUID) -> Any:
        async with self.pool.connection() as connection:
            result = await WorkflowRepository(connection).get(workflow_id)
        if result is None:
            raise WorkflowNotFoundError(str(workflow_id))
        return result

    async def _run(self, workflow_id: UUID, input_value: Any) -> None:
        lock = self._locks.setdefault(workflow_id, asyncio.Lock())
        async with lock:
            config = {"configurable": {"thread_id": str(workflow_id)}}
            try:
                result = await self.graph.ainvoke(input_value, config=config)
                await self._synchronize(workflow_id, result)
            except Exception as error:
                diagnostic = describe_error(error)
                async with self.pool.connection() as connection:
                    repository = WorkflowRepository(connection)
                    await repository.update(
                        workflow_id, phase=WorkflowPhase.FAILED, error=diagnostic
                    )
                    await repository.add_event(
                        WorkflowEvent(
                            workflow_id=workflow_id,
                            kind="workflow.failed",
                            message="Workflow execution failed",
                            phase=WorkflowPhase.FAILED,
                            data={"error": diagnostic, "error_type": type(error).__name__},
                        )
                    )
                raise

    async def _synchronize(self, workflow_id: UUID, state: dict[str, Any]) -> None:
        interrupts = state.get("__interrupt__", ())
        phase = WorkflowPhase(state.get("phase", WorkflowPhase.FAILED))
        if interrupts:
            payload = interrupts[0].value
            if payload["kind"] == "design_review":
                phase = WorkflowPhase.AWAITING_DESIGN_APPROVAL
            elif payload["kind"] == "pull_request_merge":
                phase = WorkflowPhase.AWAITING_PR_MERGE

        async with self.pool.connection() as connection:
            repository = WorkflowRepository(connection)
            detail = await repository.get(workflow_id)
            if detail is None:
                raise WorkflowNotFoundError(str(workflow_id))

            version = int(state.get("design_version", 0))
            if version > detail.current_design_version:
                await repository.add_design(
                    workflow_id,
                    DesignVersion(
                        version=version,
                        markdown=state["design_markdown"],
                        feedback=state.get("design_feedback") or None,
                    ),
                )

            serializable_state = {
                key: value for key, value in state.items() if key != "__interrupt__"
            }
            await repository.update(
                workflow_id,
                phase=phase,
                title=state.get("ticket", {}).get("title"),
                state=serializable_state,
                design_version=version or None,
                approved_version=state.get("approved_design_version"),
                pull_request_url=state.get("pull_request_url"),
                error=state.get("error") or None,
            )
            await repository.add_event(
                WorkflowEvent(
                    workflow_id=workflow_id,
                    kind="workflow.transition",
                    message=f"Workflow entered {phase.value.replace('_', ' ')}",
                    phase=phase,
                    data={"design_version": version} if version else {},
                )
            )

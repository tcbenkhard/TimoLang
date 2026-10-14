from __future__ import annotations

import asyncio
import re
import subprocess
from pathlib import Path
from typing import Any

from psycopg_pool import AsyncConnectionPool

from orchestrator.providers.git_auth import git_environment, redact_git_diagnostic
from orchestrator.repository import WorkflowRepository

GITHUB_REPOSITORY = re.compile(
    r"^(?:https://github\.com/|git@github\.com:)?(?P<account>[A-Za-z0-9-]+)/"
    r"(?P<repository>[A-Za-z0-9._-]+?)(?:\.git)?/?$"
)


def inspect_key_path(value: str) -> tuple[Path, bool]:
    path = Path(value).expanduser().resolve()
    return path, path.is_file()


class RepositoryAccessError(RuntimeError):
    pass


class GitHubRepositoryAccess:
    def __init__(self, pool: AsyncConnectionPool[Any], workspace_root: Path) -> None:
        self.pool = pool
        self.workspace_root = workspace_root.resolve()

    async def resolve_and_inspect(self, state: dict[str, Any]) -> dict[str, Any]:
        requested = state.get("requested_project")
        if state.get("source_kind") == "test" and not requested:
            return {
                "repository": {
                    "name": "configured/example-service",
                    "clone_url": "https://github.com/configured/example-service.git",
                    "base_branch": "main",
                },
                "phase": "analyzing",
            }
        if not requested:
            raise RepositoryAccessError("No repository was supplied for this workflow")
        match = GITHUB_REPOSITORY.fullmatch(requested.strip())
        if not match:
            raise RepositoryAccessError(
                "Repository must be owner/name or a GitHub HTTPS/SSH clone URL"
            )
        account = match.group("account").lower()
        repository = match.group("repository")
        async with self.pool.connection() as connection:
            credentials = await WorkflowRepository(connection).get_github_credentials(account)
        if not credentials:
            raise RepositoryAccessError(f"No credentials configured for GitHub account '{account}'")
        try:
            env = await asyncio.to_thread(git_environment, credentials, self.workspace_root)
        except ValueError as error:
            raise RepositoryAccessError(str(error)) from error

        workflow_root = (self.workspace_root / state["workflow_id"]).resolve()
        if self.workspace_root not in workflow_root.parents:
            raise RepositoryAccessError("Invalid workflow workspace path")
        checkout = workflow_root / "repository"
        checkout.parent.mkdir(parents=True, exist_ok=True)
        clone_url = (
            f"https://github.com/{account}/{repository}.git"
            if credentials.get("pat_token")
            else f"git@github.com:{account}/{repository}.git"
        )
        if not (checkout / ".git").is_dir():
            await self._git_clone(clone_url, checkout, env)

        analysis = await asyncio.to_thread(self._inspect, checkout)
        return {
            "repository": {
                "name": f"{account}/{repository}",
                "account": account,
                "clone_url": clone_url,
                "base_branch": analysis.pop("default_branch"),
                "local_path": str(checkout),
                "analysis": analysis,
            },
            "phase": "analyzing",
        }

    async def _git_clone(self, clone_url: str, checkout: Path, env: dict[str, str]) -> None:
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        result = await asyncio.to_thread(
            subprocess.run,
            ["git", "clone", "--depth", "1", "--", clone_url, str(checkout)],
            capture_output=True,
            check=False,
            env=env,
        )
        if result.returncode:
            message = redact_git_diagnostic(result.stderr.decode(errors="replace").strip(), env)
            raise RepositoryAccessError(f"Git clone failed: {message[-2_000:]}")

    @staticmethod
    def _inspect(checkout: Path) -> dict[str, Any]:
        ignored = {".git", "node_modules", ".venv", "dist", "build", "vendor"}
        files = [
            path.relative_to(checkout).as_posix()
            for path in checkout.rglob("*")
            if path.is_file() and not any(part in ignored for part in path.parts)
        ][:2_000]
        manifests = [
            name
            for name in (
                "README.md",
                "pyproject.toml",
                "package.json",
                "pom.xml",
                "build.gradle",
                "go.mod",
                "Cargo.toml",
                "Dockerfile",
                "docker-compose.yml",
            )
            if (checkout / name).is_file()
        ]
        readme = ""
        readme_path = checkout / "README.md"
        if readme_path.is_file():
            readme = readme_path.read_text(encoding="utf-8", errors="replace")[:8_000]
        extensions: dict[str, int] = {}
        for name in files:
            suffix = Path(name).suffix.lower() or "[no extension]"
            extensions[suffix] = extensions.get(suffix, 0) + 1
        head = (checkout / ".git" / "HEAD").read_text(encoding="utf-8").strip()
        default_branch = head.rsplit("/", 1)[-1] if head.startswith("ref:") else "main"
        return {
            "file_count": len(files),
            "sample_files": files[:100],
            "manifests": manifests,
            "extensions": dict(sorted(extensions.items(), key=lambda item: -item[1])[:15]),
            "readme_excerpt": readme,
            "default_branch": default_branch,
        }

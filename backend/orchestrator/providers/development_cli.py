from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from orchestrator.domain import DesignProviderName, WorkflowEvent, WorkflowPhase
from orchestrator.prompts import PromptId, render_prompt
from orchestrator.providers.codex import codex_runtime
from orchestrator.providers.git_auth import git_environment, redact_git_diagnostic
from orchestrator.repository import WorkflowRepository


class DevelopmentError(RuntimeError):
    pass


class CliDevelopmentProvider:
    def __init__(
        self,
        pool: AsyncConnectionPool[Any],
        workspace_root: Path,
        timeout_seconds: int = 1_800,
    ) -> None:
        self.pool = pool
        self.workspace_root = workspace_root.resolve()
        self.timeout_seconds = timeout_seconds

    async def implement(self, state: dict[str, Any]) -> dict[str, Any]:
        checkout = self._checkout(state)
        execution_id = state.get("execution_id", "run")[:8]
        branch = state.get("branch") or f"relay/{state['workflow_id'][:8]}-{execution_id}"
        iteration = int(state.get("development_iteration", 0)) + 1
        await self._prepare_branch(checkout, branch)

        provider = await self._selected_provider(state)
        executable = shutil.which(provider.command)
        if not executable:
            raise DevelopmentError(f"{provider.label} CLI is not installed or available on PATH")
        prompt = self._implementation_prompt(state, iteration)
        if provider is DesignProviderName.CODEX:
            try:
                executable, command_environment = codex_runtime(executable)
            except FileNotFoundError as error:
                raise DevelopmentError(str(error)) from error
            command = [
                executable,
                "exec",
                "--model",
                "gpt-5.6-sol",
                "--sandbox",
                "workspace-write",
                "--ephemeral",
                "-",
            ]
        else:
            command_environment = None
            command = [
                executable,
                "-p",
                "--output-format",
                "json",
                "--permission-mode",
                "acceptEdits",
                "--allowedTools",
                "Read,Edit,Write,Glob,Grep,Bash",
            ]
        agent_result = await self._run(
            command,
            checkout,
            input_text=prompt,
            env=command_environment,
            command_timeout=self.timeout_seconds,
        )

        commit_sha = await self._commit_changes(state, checkout, branch, agent_result.stdout)
        return {
            "phase": WorkflowPhase.DEVELOPING,
            "development_iteration": iteration,
            "branch": branch,
            "commit_sha": commit_sha,
            "test_failures": 0,
            "review_findings": 0,
            "implementation_provider": provider,
        }

    async def prepare_pull_request(self, state: dict[str, Any]) -> dict[str, Any]:
        repository = state["repository"]
        base = quote(repository["base_branch"], safe="")
        branch = quote(state["branch"], safe="")
        url = f"https://github.com/{repository['name']}/compare/{base}...{branch}?expand=1"
        return {"pull_request_url": url, "phase": WorkflowPhase.AWAITING_PR_MERGE}

    async def review(self, state: dict[str, Any]) -> dict[str, Any]:
        await self._mark_review_started(state)
        checkout = self._checkout(state)
        provider = await self._selected_provider(state)
        executable = shutil.which(provider.command)
        if not executable:
            raise DevelopmentError(f"{provider.label} CLI is not installed or available on PATH")

        prompt = self._review_prompt(state)
        if provider is DesignProviderName.CODEX:
            try:
                executable, command_environment = codex_runtime(executable)
            except FileNotFoundError as error:
                raise DevelopmentError(str(error)) from error
            with tempfile.TemporaryDirectory(prefix="timo-review-") as temporary:
                output_path = Path(temporary) / "review.json"
                await self._run(
                    [
                        executable,
                        "exec",
                        "--model",
                        "gpt-5.6-sol",
                        "--sandbox",
                        "read-only",
                        "--ephemeral",
                        "--output-last-message",
                        str(output_path),
                        "-",
                    ],
                    checkout,
                    input_text=prompt,
                    env=command_environment,
                    command_timeout=self.timeout_seconds,
                )
                if not output_path.is_file():
                    raise DevelopmentError("Codex completed without producing a code review")
                response = output_path.read_text(encoding="utf-8", errors="replace")
        else:
            result = await self._run(
                [
                    executable,
                    "-p",
                    "--output-format",
                    "json",
                    "--permission-mode",
                    "plan",
                ],
                checkout,
                input_text=prompt,
                command_timeout=self.timeout_seconds,
            )
            try:
                response = json.loads(result.stdout)["result"]
            except (json.JSONDecodeError, KeyError, TypeError) as error:
                raise DevelopmentError("Claude returned an invalid code review response") from error

        findings, markdown = self._parse_review(response)
        scenario = state.get("scenario", {})
        iteration = int(state.get("development_iteration", 1))
        review_target = int(scenario.get("review_findings_before_success", 0))
        test_target = int(scenario.get("test_failures_before_success", 0))
        if review_target:
            findings = max(findings, review_target - iteration + 1)
        return {
            "phase": WorkflowPhase.REVIEWING,
            "review_iteration": int(state.get("review_iteration", 0)) + 1,
            "test_failures": max(0, test_target - iteration + 1),
            "review_findings": findings,
            "review_markdown": markdown,
        }

    async def _mark_review_started(self, state: dict[str, Any]) -> None:
        workflow_id = UUID(state["workflow_id"])
        async with self.pool.connection() as connection:
            repository = WorkflowRepository(connection)
            await repository.update(workflow_id, phase=WorkflowPhase.REVIEWING)
            await repository.add_event(
                WorkflowEvent(
                    workflow_id=workflow_id,
                    kind="workflow.transition",
                    message="Implementation completed; AI code review started",
                    phase=WorkflowPhase.REVIEWING,
                )
            )

    async def _selected_provider(self, state: dict[str, Any]) -> DesignProviderName:
        design_provider = state.get("design_provider")
        if design_provider:
            return DesignProviderName(design_provider)
        async with self.pool.connection() as connection:
            selected = await WorkflowRepository(connection).get_setting(
                "design_provider", DesignProviderName.CODEX
            )
        return DesignProviderName(selected)

    def _checkout(self, state: dict[str, Any]) -> Path:
        value = state.get("repository", {}).get("local_path")
        if not value:
            raise DevelopmentError("The workflow does not have a repository checkout")
        checkout = Path(value).resolve()
        if not (checkout / ".git").is_dir():
            raise DevelopmentError(f"Repository checkout is unavailable: {checkout}")
        return checkout

    async def _prepare_branch(self, checkout: Path, branch: str) -> None:
        exists = await self._run(["git", "branch", "--list", branch], checkout, command_timeout=30)
        command = (
            ["git", "checkout", branch]
            if exists.stdout.strip()
            else [
                "git",
                "checkout",
                "-b",
                branch,
            ]
        )
        await self._run(command, checkout, command_timeout=30)

    async def _commit_changes(
        self,
        state: dict[str, Any],
        checkout: Path,
        branch: str,
        agent_output: str,
    ) -> str:
        status = await self._run(["git", "status", "--porcelain"], checkout, command_timeout=30)
        if status.stdout.strip():
            await self._run(["git", "add", "-A"], checkout, command_timeout=30)
            await self._run(
                [
                    "git",
                    "-c",
                    "user.name=Relay",
                    "-c",
                    "user.email=relay@localhost",
                    "commit",
                    "-m",
                    f"Implement {str(state['ticket']['title'])[:60]}",
                ],
                checkout,
                command_timeout=60,
            )
        base = state["repository"]["base_branch"]
        ahead = await self._run(
            ["git", "rev-list", "--count", f"{base}..HEAD"],
            checkout,
            command_timeout=30,
        )
        if int(ahead.stdout.strip() or "0") < 1:
            summary = agent_output.strip()[-1_500:]
            raise DevelopmentError(
                "The agent completed without making implementation changes. "
                f"Agent output: {summary or 'No final output was returned.'}"
            )

        env = await self._git_environment(state)
        name = state["repository"]["name"]
        remote = (
            f"https://github.com/{name}.git"
            if env["RELAY_GIT_TRANSPORT"] == "https"
            else f"git@github.com:{name}.git"
        )
        await self._run(
            ["git", "remote", "set-url", "origin", remote],
            checkout,
            command_timeout=30,
        )
        await self._run(
            ["git", "push", "--set-upstream", "origin", branch],
            checkout,
            env=env,
            command_timeout=120,
        )
        result = await self._run(["git", "rev-parse", "HEAD"], checkout, command_timeout=30)
        return result.stdout.strip()

    async def _git_environment(self, state: dict[str, Any]) -> dict[str, str]:
        account = state["repository"].get("account")
        if not account:
            raise DevelopmentError("The repository does not identify a GitHub account")
        async with self.pool.connection() as connection:
            credentials = await WorkflowRepository(connection).get_github_credentials(account)
        if not credentials:
            raise DevelopmentError(f"No credentials configured for GitHub account '{account}'")
        try:
            return await asyncio.to_thread(git_environment, credentials, self.workspace_root)
        except ValueError as error:
            raise DevelopmentError(str(error)) from error

    async def _run(
        self,
        command: list[str],
        cwd: Path,
        *,
        input_text: str | None = None,
        env: dict[str, str] | None = None,
        command_timeout: int,
    ) -> subprocess.CompletedProcess[str]:
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                command,
                cwd=cwd,
                input=input_text,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=command_timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise DevelopmentError(f"Command failed to start or timed out: {command[0]}") from error
        if result.returncode:
            diagnostic = redact_git_diagnostic(
                result.stderr.strip() or result.stdout.strip(), env or {}
            )[-2_000:]
            raise DevelopmentError(
                f"Command '{Path(command[0]).name}' exited with code {result.returncode}: "
                f"{diagnostic or 'no diagnostic was returned'}"
            )
        return result

    @staticmethod
    def _implementation_prompt(state: dict[str, Any], iteration: int) -> str:
        feedback = state.get("review_markdown") or state.get("design_feedback")
        feedback = feedback or "No additional review feedback."
        return render_prompt(
            PromptId.IMPLEMENTATION,
            {
                "iteration": iteration,
                "approved_design": state["design_markdown"],
                "review_feedback": feedback,
            },
        )

    @staticmethod
    def _review_prompt(state: dict[str, Any]) -> str:
        return render_prompt(
            PromptId.REVIEW,
            {
                "base_branch": state["repository"]["base_branch"],
                "approved_design": state["design_markdown"],
            },
        )

    @staticmethod
    def _parse_review(response: Any) -> tuple[int, str]:
        if not isinstance(response, str):
            raise DevelopmentError("AI reviewer completed without returning text")
        payload_text = response.strip()
        if payload_text.startswith("```"):
            lines = payload_text.splitlines()
            payload_text = "\n".join(lines[1:-1]).strip()
        try:
            payload = json.loads(payload_text)
            findings = int(payload["findings"])
            markdown = payload["remarks_markdown"]
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            raise DevelopmentError("AI reviewer returned invalid review JSON") from error
        if findings < 0 or not isinstance(markdown, str) or not markdown.strip():
            raise DevelopmentError("AI reviewer returned incomplete review results")
        return findings, markdown.strip()

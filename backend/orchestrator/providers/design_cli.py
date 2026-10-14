from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from psycopg_pool import AsyncConnectionPool

from orchestrator.domain import DesignProviderName, WorkflowPhase
from orchestrator.prompts import PromptId, render_prompt
from orchestrator.providers.codex import codex_runtime
from orchestrator.repository import WorkflowRepository


class DesignGenerationError(RuntimeError):
    pass


class CliDesignProvider:
    def __init__(self, pool: AsyncConnectionPool[Any], timeout_seconds: int = 300) -> None:
        self.pool = pool
        self.timeout_seconds = timeout_seconds

    async def generate(self, state: dict[str, Any]) -> dict[str, Any]:
        async with self.pool.connection() as connection:
            selected = await WorkflowRepository(connection).get_setting(
                "design_provider", DesignProviderName.CODEX
            )
        provider = DesignProviderName(selected)
        executable = shutil.which(provider.command)
        if not executable:
            raise DesignGenerationError(
                f"{provider.label} CLI is not installed or is not available on PATH"
            )

        version = int(state.get("design_version", 0)) + 1
        prompt = self._prompt(state, version)
        repository_path = state["repository"].get("local_path")
        working_directory = Path(repository_path) if repository_path else Path.cwd()

        if provider is DesignProviderName.CODEX:
            markdown = await self._run_codex(executable, prompt, working_directory)
        else:
            markdown = await self._run_claude(executable, prompt, working_directory)
        self._validate(markdown)
        return {
            "phase": WorkflowPhase.DESIGNING,
            "design_version": version,
            "design_markdown": markdown.strip(),
            "design_provider": provider,
        }

    async def _run_codex(self, executable: str, prompt: str, cwd: Path) -> str:
        try:
            executable, environment = codex_runtime(executable)
        except FileNotFoundError as error:
            raise DesignGenerationError(str(error)) from error
        with tempfile.TemporaryDirectory(prefix="timo-design-") as temporary:
            output_path = Path(temporary) / "design.md"
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
                prompt,
                cwd,
                DesignProviderName.CODEX,
                env=environment,
            )
            if not output_path.is_file():
                raise DesignGenerationError("Codex completed without producing a design")
            return output_path.read_text(encoding="utf-8", errors="replace")

    async def _run_claude(self, executable: str, prompt: str, cwd: Path) -> str:
        stdout = await self._run(
            [
                executable,
                "-p",
                "--output-format",
                "json",
                "--permission-mode",
                "plan",
            ],
            prompt,
            cwd,
            DesignProviderName.CLAUDE,
        )
        try:
            payload = json.loads(stdout)
            if not isinstance(payload, dict):
                raise TypeError("Expected a JSON object")
            if payload.get("is_error"):
                raise DesignGenerationError(
                    f"Claude design generation failed: {self._diagnostic('', stdout)}"
                )
            result = payload["result"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise DesignGenerationError("Claude returned an invalid JSON response") from error
        if not isinstance(result, str):
            raise DesignGenerationError("Claude completed without producing a design")
        return result

    async def _run(
        self,
        command: list[str],
        prompt: str,
        cwd: Path,
        provider: DesignProviderName,
        env: dict[str, str] | None = None,
    ) -> str:
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                command,
                cwd=cwd,
                input=prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise DesignGenerationError(
                f"{provider.label} design generation timed out after {self.timeout_seconds} seconds"
            ) from error
        except OSError as error:
            raise DesignGenerationError(
                f"Unable to start the {provider.label} CLI: {error}"
            ) from error
        if result.returncode:
            diagnostic = self._diagnostic(result.stderr, result.stdout)
            raise DesignGenerationError(
                f"{provider.label} CLI exited with code {result.returncode}: "
                f"{diagnostic or 'no diagnostic was returned'}"
            )
        return result.stdout

    @staticmethod
    def _diagnostic(stderr: str, stdout: str) -> str:
        if stderr.strip():
            return stderr.strip()[-2_000:]
        diagnostic = stdout.strip()
        try:
            payload = json.loads(diagnostic)
        except json.JSONDecodeError:
            pass
        else:
            if isinstance(payload, dict):
                result = payload.get("result")
                errors = payload.get("errors")
                if isinstance(result, str) and result.strip():
                    diagnostic = result.strip()
                elif isinstance(errors, list) and errors:
                    diagnostic = "; ".join(str(error) for error in errors)
        return diagnostic[-2_000:]

    @staticmethod
    def _prompt(state: dict[str, Any], version: int) -> str:
        ticket = state["ticket"]
        repository = state["repository"]
        analysis = repository.get("analysis", {})
        feedback = state.get("design_feedback") or "None; this is the first version."
        return render_prompt(
            PromptId.DESIGN,
            {
                "version": version,
                "ticket_title": ticket["title"],
                "ticket_description": ticket["description"],
                "acceptance_criteria": json.dumps(ticket["acceptance_criteria"], indent=2),
                "repository_name": repository["name"],
                "repository_analysis": json.dumps(analysis, indent=2, default=str),
                "review_feedback": feedback,
            },
        )

    @staticmethod
    def _validate(markdown: str) -> None:
        headings = [
            "## 1. Summary",
            "## 2. Technical and functional acceptance criteria",
            "## 3. Existing system analysis",
            "## 4. Functional implementation",
            "## 5. Testing strategy",
            "## 6. Risks",
            "## 7. Open questions",
            "### Functional acceptance criteria",
            "### Technical acceptance criteria",
            "### Framework",
            "### Project structure",
            "### Project architecture",
            "### Existing functional design",
            "### Potential refactoring required",
            "### Security considerations",
            "### New feature flow",
            "### Functional design",
        ]
        missing = [heading for heading in headings if heading not in markdown]
        if missing:
            raise DesignGenerationError(
                "AI design response is missing required sections: " + ", ".join(missing)
            )

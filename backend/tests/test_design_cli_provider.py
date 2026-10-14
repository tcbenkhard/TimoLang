import json
import subprocess
from pathlib import Path

import pytest
from orchestrator.domain import DesignProviderName
from orchestrator.providers.design_cli import CliDesignProvider, DesignGenerationError


def test_design_prompt_requires_functional_and_technical_analysis() -> None:
    prompt = CliDesignProvider._prompt(
        {
            "ticket": {
                "title": "Add export",
                "description": "Users export filtered results.",
                "acceptance_criteria": ["Active filters are respected"],
            },
            "repository": {
                "name": "acme/reports",
                "analysis": {"manifests": ["package.json"]},
            },
        },
        1,
    )

    normalized = prompt.lower()
    assert "framework" in normalized
    assert "project architecture" in normalized
    assert "existing functional design" in normalized
    assert "potential refactoring required" in normalized
    assert "security considerations" in normalized
    assert "happy path" in prompt
    assert "Mermaid flowcharts" in prompt
    assert "wholly new functionality" in prompt
    assert "#### Old flow" in prompt
    assert "#### New flow" in prompt
    assert "fenced `mermaid` code blocks" in prompt
    assert "Active filters are respected" in prompt
    assert "## 1. Summary" in prompt
    assert "## 7. Open questions" in prompt
    assert "Add export" in prompt
    assert "acme/reports" in prompt


def test_design_validation_rejects_incomplete_ai_output() -> None:
    with pytest.raises(DesignGenerationError, match="missing required sections"):
        CliDesignProvider._validate("## 1. Summary\nIncomplete")


def test_design_validation_accepts_all_required_sections() -> None:
    markdown = "\n".join(
        (
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
        )
    )

    CliDesignProvider._validate(markdown)


@pytest.mark.asyncio
async def test_cli_execution_uses_thread_safe_subprocess_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def completed(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="design", stderr="")

    monkeypatch.setattr(subprocess, "run", completed)
    provider = CliDesignProvider(pool=object())  # type: ignore[arg-type]

    result = await provider._run(["codex", "exec"], "prompt", Path.cwd(), DesignProviderName.CODEX)

    assert result == "design"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("stdout", "stderr", "diagnostic"),
    [
        (
            json.dumps({"is_error": True, "result": "Not logged in · Please run /login"}),
            "",
            "Not logged in · Please run /login",
        ),
        (json.dumps({"errors": ["Maximum turns reached"]}), "", "Maximum turns reached"),
        ("CLI failed before JSON output", "", "CLI failed before JSON output"),
        ("stdout detail", "stderr detail", "stderr detail"),
        ("", "", "no diagnostic was returned"),
    ],
)
async def test_cli_failure_preserves_diagnostic(
    monkeypatch: pytest.MonkeyPatch, stdout: str, stderr: str, diagnostic: str
) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=[], returncode=1, stdout=stdout, stderr=stderr
        ),
    )
    provider = CliDesignProvider(pool=object())  # type: ignore[arg-type]

    with pytest.raises(DesignGenerationError) as error:
        await provider._run(["claude", "-p"], "prompt", Path.cwd(), DesignProviderName.CLAUDE)

    assert str(error.value) == f"Claude CLI exited with code 1: {diagnostic}"


@pytest.mark.asyncio
async def test_claude_error_payload_is_rejected_even_with_successful_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps({"is_error": True, "errors": ["Maximum turns reached"]}),
            stderr="",
        ),
    )
    provider = CliDesignProvider(pool=object())  # type: ignore[arg-type]

    with pytest.raises(DesignGenerationError, match="Maximum turns reached"):
        await provider._run_claude("claude", "prompt", Path.cwd())


def test_cli_diagnostic_is_bounded() -> None:
    assert CliDesignProvider._diagnostic("", json.dumps({"result": "x" * 3_000})) == "x" * 2_000

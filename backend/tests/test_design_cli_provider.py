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

    result = await provider._run(
        ["codex", "exec"], "prompt", Path.cwd(), DesignProviderName.CODEX
    )

    assert result == "design"

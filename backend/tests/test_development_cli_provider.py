from pathlib import Path

import pytest
from orchestrator.domain import DesignProviderName
from orchestrator.providers.development_cli import CliDevelopmentProvider, DevelopmentError


def provider() -> CliDevelopmentProvider:
    return CliDevelopmentProvider(pool=object(), workspace_root=Path.cwd())  # type: ignore[arg-type]


def test_implementation_prompt_uses_the_approved_design() -> None:
    prompt = provider()._implementation_prompt(
        {
            "design_markdown": "## 1. Summary\nAdd filtered export",
            "design_feedback": "Keep the existing authorization rule",
        },
        2,
    )

    assert "Add filtered export" in prompt
    assert "Keep the existing authorization rule" in prompt
    assert "Do not commit, push, create a pull request" in prompt
    assert "DRY, SOLID, and KISS" in prompt
    assert "Readability is essential" in prompt
    normalized = " ".join(prompt.split())
    assert "Split code logically across files" in normalized
    assert "existing structure" in normalized


@pytest.mark.asyncio
async def test_implementation_reuses_the_provider_that_created_the_design() -> None:
    selected = await provider()._selected_provider({"design_provider": "claude"})

    assert selected is DesignProviderName.CLAUDE


def test_checkout_is_required_for_implementation() -> None:
    with pytest.raises(DevelopmentError, match="does not have a repository checkout"):
        provider()._checkout({"repository": {}})


def test_review_prompt_covers_requested_quality_checks() -> None:
    prompt = provider()._review_prompt(
        {
            "repository": {"base_branch": "main"},
            "design_markdown": "## Approved design",
        }
    )

    assert "code readability" in prompt
    assert "code correctness" in prompt
    assert "potential bugs" in prompt
    assert "anti-patterns and code smells" in prompt
    assert "DRY, SOLID, and KISS" in prompt
    assert "Do not edit files" in prompt


def test_review_response_is_parsed_from_json_fence() -> None:
    findings, markdown = provider()._parse_review(
        '```json\n{"findings": 1, "remarks_markdown": "## High\\nFix the bug"}\n```'
    )

    assert findings == 1
    assert markdown == "## High\nFix the bug"


@pytest.mark.asyncio
async def test_pull_request_step_returns_a_github_compare_link() -> None:
    result = await provider().prepare_pull_request(
        {
            "repository": {"name": "acme/reports", "base_branch": "main"},
            "branch": "relay/1234abcd",
        }
    )

    assert result["pull_request_url"] == (
        "https://github.com/acme/reports/compare/main...relay%2F1234abcd?expand=1"
    )

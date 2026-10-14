from __future__ import annotations

from pathlib import Path

import pytest

from orchestrator.prompts import PromptError, PromptId, render_prompt
from orchestrator.prompts import catalog


def values_for(prompt_id: PromptId) -> dict[str, object]:
    return {name: f"value for {name}" for name in catalog._PROMPTS[prompt_id].placeholders}


@pytest.mark.parametrize("prompt_id", list(PromptId))
def test_every_prompt_loads_with_documented_markdown_structure(prompt_id: PromptId) -> None:
    rendered = render_prompt(prompt_id, values_for(prompt_id))

    assert rendered.startswith("# ")
    assert "## Purpose" in rendered
    assert "## Instructions and constraints" in rendered
    assert "## Inputs" in rendered
    assert "## Output requirements" in rendered


def test_rendering_preserves_unicode_multiline_and_placeholder_like_input() -> None:
    approved_design = "First line\n```json\n{\"price\": \"$5\"}\n```\n{{base_branch}}\n雪"

    rendered = render_prompt(
        PromptId.REVIEW,
        {"base_branch": "main", "approved_design": approved_design},
    )

    assert approved_design in rendered
    assert rendered.count("{{base_branch}}") == 1
    assert "雪" in rendered


@pytest.mark.parametrize(
    ("values", "diagnostic"),
    [
        ({"base_branch": "main"}, "missing values: approved_design"),
        (
            {"base_branch": "main", "approved_design": "secret-value", "extra": "x"},
            "unexpected values: extra",
        ),
    ],
)
def test_invalid_inputs_are_rejected_without_exposing_values(
    values: dict[str, object], diagnostic: str
) -> None:
    with pytest.raises(PromptError, match=diagnostic) as error:
        render_prompt(PromptId.REVIEW, values)

    assert "secret-value" not in str(error.value)


def test_unknown_and_path_like_prompt_ids_are_rejected() -> None:
    with pytest.raises(PromptError, match="Unknown prompt"):
        render_prompt("../secret", {})  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("template", "diagnostic"),
    [
        ("{{base_branch}} {{approved_design}} {{unknown}}", "unexpected placeholders"),
        ("{{base_branch}} {{approved_design}} {{bad-token}}", "malformed placeholder"),
        ("{{{base_branch}}} {{approved_design}}", "malformed placeholder"),
        ("{{{base_branch}} {{approved_design}}", "malformed placeholder"),
        ("{{base_branch}}} {{approved_design}}", "malformed placeholder"),
        ("{{base_branch}} {{approved_design}", "malformed placeholder"),
        ("{{base_branch}} approved_design}}", "malformed placeholder"),
        ("{{base_branch}}", "missing placeholders"),
        (
            "{{base_branch}} {{approved_design}} {{approved_design}}",
            "duplicate placeholders",
        ),
    ],
)
def test_invalid_template_contract_is_rejected(
    monkeypatch: pytest.MonkeyPatch, template: str, diagnostic: str
) -> None:
    monkeypatch.setattr(catalog, "_load_template", lambda *_: template)

    with pytest.raises(PromptError, match=diagnostic):
        render_prompt(
            PromptId.REVIEW,
            {"base_branch": "main", "approved_design": "private design"},
        )


def test_missing_resource_has_safe_diagnostic(monkeypatch: pytest.MonkeyPatch) -> None:
    class MissingResource:
        def joinpath(self, filename: str) -> MissingResource:
            return self

        def read_text(self, *, encoding: str) -> str:
            raise FileNotFoundError

    monkeypatch.setattr(catalog.resources, "files", lambda package: MissingResource())

    with pytest.raises(PromptError, match="review.*unavailable or unreadable") as error:
        render_prompt(
            PromptId.REVIEW,
            {"base_branch": "private-branch", "approved_design": "private design"},
        )

    assert "private" not in str(error.value)


def test_prompts_load_outside_repository_working_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)

    assert "value for approved_design" in render_prompt(
        PromptId.IMPLEMENTATION, values_for(PromptId.IMPLEMENTATION)
    )


def test_provider_modules_do_not_contain_ai_prompt_prose() -> None:
    providers = Path(__file__).parents[1] / "orchestrator" / "providers"

    for filename in ("design_cli.py", "development_cli.py"):
        source = (providers / filename).read_text(encoding="utf-8")
        assert "You are a senior product analyst" not in source
        assert "Check specifically for:" not in source
        assert "Implement the approved design below" not in source

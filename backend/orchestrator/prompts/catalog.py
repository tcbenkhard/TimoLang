from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from importlib import resources
from typing import Mapping


class PromptId(StrEnum):
    DESIGN = "design"
    IMPLEMENTATION = "implementation"
    REVIEW = "review"


class PromptError(RuntimeError):
    """A safe diagnostic for an unavailable or invalid application prompt."""


@dataclass(frozen=True)
class PromptSpec:
    filename: str
    placeholders: frozenset[str]


_PROMPTS = {
    PromptId.DESIGN: PromptSpec(
        "design.md",
        frozenset(
            {
                "version",
                "ticket_title",
                "ticket_description",
                "acceptance_criteria",
                "repository_name",
                "repository_analysis",
                "review_feedback",
            }
        ),
    ),
    PromptId.IMPLEMENTATION: PromptSpec(
        "implementation.md",
        frozenset({"iteration", "approved_design", "review_feedback"}),
    ),
    PromptId.REVIEW: PromptSpec(
        "review.md", frozenset({"base_branch", "approved_design"})
    ),
}
_PLACEHOLDER = re.compile(r"{{([a-z][a-z0-9_]*)}}")


def render_prompt(prompt_id: PromptId, values: Mapping[str, object]) -> str:
    """Load and render an application-owned prompt exactly once."""
    try:
        spec = _PROMPTS[prompt_id]
    except (KeyError, TypeError) as error:
        raise PromptError(f"Unknown prompt '{_safe_identifier(prompt_id)}'") from error

    template = _load_template(prompt_id, spec)
    placeholders = _validate_template(prompt_id, template, spec)
    supplied = frozenset(values)
    missing = spec.placeholders - supplied
    unexpected = supplied - spec.placeholders
    if missing or unexpected:
        problems = []
        if missing:
            problems.append(f"missing values: {', '.join(sorted(missing))}")
        if unexpected:
            problems.append(f"unexpected values: {', '.join(sorted(unexpected))}")
        raise PromptError(f"Prompt '{prompt_id.value}' has invalid inputs ({'; '.join(problems)})")

    rendered_values = {name: str(values[name]) for name in placeholders}
    return _PLACEHOLDER.sub(lambda match: rendered_values[match.group(1)], template)


def _load_template(prompt_id: PromptId, spec: PromptSpec) -> str:
    try:
        return resources.files("orchestrator.prompts").joinpath(spec.filename).read_text(
            encoding="utf-8"
        )
    except (OSError, UnicodeError) as error:
        message = f"Prompt '{prompt_id.value}' resource is unavailable or unreadable"
        raise PromptError(message) from error


def _validate_template(prompt_id: PromptId, template: str, spec: PromptSpec) -> frozenset[str]:
    matches = tuple(_PLACEHOLDER.finditer(template))
    found = frozenset(match.group(1) for match in matches)
    text_without_tokens = _PLACEHOLDER.sub("", template)
    malformed = "{{" in text_without_tokens or "}}" in text_without_tokens
    missing = spec.placeholders - found
    unexpected = found - spec.placeholders
    duplicates = sorted(name for name in found if template.count(f"{{{{{name}}}}}") != 1)
    if malformed or missing or unexpected or duplicates:
        problems = []
        if malformed:
            problems.append("malformed placeholder")
        if missing:
            problems.append(f"missing placeholders: {', '.join(sorted(missing))}")
        if unexpected:
            problems.append(f"unexpected placeholders: {', '.join(sorted(unexpected))}")
        if duplicates:
            problems.append(f"duplicate placeholders: {', '.join(duplicates)}")
        raise PromptError(f"Prompt '{prompt_id.value}' template is invalid ({'; '.join(problems)})")
    return found


def _safe_identifier(value: object) -> str:
    return str(value)[:80].replace("\n", " ").replace("\r", " ")

from __future__ import annotations

from collections import Counter
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
_PLACEHOLDER_NAME_CHARACTERS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_")


@dataclass(frozen=True)
class _Placeholder:
    start: int
    end: int
    name: str


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

    rendered_values = {name: str(values[name]) for name in spec.placeholders}
    rendered_parts: list[str] = []
    previous_end = 0
    for placeholder in placeholders:
        rendered_parts.append(template[previous_end : placeholder.start])
        rendered_parts.append(rendered_values[placeholder.name])
        previous_end = placeholder.end
    rendered_parts.append(template[previous_end:])
    return "".join(rendered_parts)


def _load_template(prompt_id: PromptId, spec: PromptSpec) -> str:
    try:
        return resources.files("orchestrator.prompts").joinpath(spec.filename).read_text(
            encoding="utf-8"
        )
    except (OSError, UnicodeError) as error:
        message = f"Prompt '{prompt_id.value}' resource is unavailable or unreadable"
        raise PromptError(message) from error


def _validate_template(
    prompt_id: PromptId, template: str, spec: PromptSpec
) -> tuple[_Placeholder, ...]:
    try:
        placeholders = _parse_placeholders(template)
    except ValueError as error:
        raise PromptError(
            f"Prompt '{prompt_id.value}' template is invalid (malformed placeholder)"
        ) from error

    counts = Counter(placeholder.name for placeholder in placeholders)
    found = frozenset(counts)
    missing = spec.placeholders - found
    unexpected = found - spec.placeholders
    duplicates = sorted(name for name, count in counts.items() if count != 1)
    if missing or unexpected or duplicates:
        problems = []
        if missing:
            problems.append(f"missing placeholders: {', '.join(sorted(missing))}")
        if unexpected:
            problems.append(f"unexpected placeholders: {', '.join(sorted(unexpected))}")
        if duplicates:
            problems.append(f"duplicate placeholders: {', '.join(duplicates)}")
        raise PromptError(f"Prompt '{prompt_id.value}' template is invalid ({'; '.join(problems)})")
    return placeholders


def _parse_placeholders(template: str) -> tuple[_Placeholder, ...]:
    """Parse exact ``{{name}}`` tokens while allowing ordinary single braces."""
    placeholders: list[_Placeholder] = []
    index = 0
    while index < len(template):
        if template.startswith("}}", index):
            raise ValueError("closing delimiter without an opening delimiter")
        if not template.startswith("{{", index):
            index += 1
            continue

        start = index
        index += 2
        name_start = index
        if index >= len(template) or not "a" <= template[index] <= "z":
            raise ValueError("placeholder name must start with a lowercase letter")
        index += 1
        while index < len(template) and template[index] in _PLACEHOLDER_NAME_CHARACTERS:
            index += 1
        name = template[name_start:index]
        if not template.startswith("}}", index):
            raise ValueError("placeholder is missing its closing delimiter")
        index += 2
        if index < len(template) and template[index] == "}":
            raise ValueError("placeholder has an extra closing brace")
        placeholders.append(_Placeholder(start=start, end=index, name=name))

    return tuple(placeholders)


def _safe_identifier(value: object) -> str:
    return str(value)[:80].replace("\n", " ").replace("\r", " ")

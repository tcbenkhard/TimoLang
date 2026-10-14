from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


class WorkflowPhase(StrEnum):
    INGESTING = "ingesting"
    ANALYZING = "analyzing"
    DESIGNING = "designing"
    AWAITING_DESIGN_APPROVAL = "awaiting_design_approval"
    DEVELOPING = "developing"
    REVIEWING = "reviewing"
    AWAITING_PR_MERGE = "awaiting_pr_merge"
    DEPLOYING = "deploying"
    VERIFYING = "verifying"
    REPORTING = "reporting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class ReviewAction(StrEnum):
    APPROVE = "approve"
    REQUEST_CHANGES = "request_changes"
    REJECT = "reject"


class DesignProviderName(StrEnum):
    CODEX = "codex"
    CLAUDE = "claude"

    @property
    def command(self) -> str:
        return self.value

    @property
    def label(self) -> str:
        return "Codex" if self is DesignProviderName.CODEX else "Claude"


class MockScenario(BaseModel):
    test_failures_before_success: int = Field(default=0, ge=0, le=10)
    review_findings_before_success: int = Field(default=0, ge=0, le=10)


class WorkflowCreate(BaseModel):
    wrike_url: HttpUrl | None = None
    test_id: str | None = Field(
        default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    request_text: str | None = Field(default=None, min_length=10, max_length=20_000)
    project: str | None = Field(default=None, min_length=1, max_length=500)
    mock_scenario: MockScenario = Field(default_factory=MockScenario)

    @field_validator("wrike_url")
    @classmethod
    def validate_wrike_domain(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is None:
            return value
        host = (value.host or "").lower()
        if host != "wrike.com" and not host.endswith(".wrike.com"):
            raise ValueError("Only Wrike task URLs are supported")
        return value

    @model_validator(mode="after")
    def validate_source(self) -> WorkflowCreate:
        source_count = sum(
            source is not None for source in (self.wrike_url, self.test_id, self.request_text)
        )
        if source_count != 1:
            raise ValueError("Provide exactly one of wrike_url, test_id, or request_text")
        if self.request_text and not self.project:
            raise ValueError("A project or repository is required for a text request")
        return self

    @property
    def source_url(self) -> str:
        if self.test_id:
            return f"https://www.wrike.com/open.htm?id=TEST-{self.test_id}"
        if self.request_text:
            return "local://user-request"
        return str(self.wrike_url)

    @property
    def source_kind(self) -> str:
        if self.test_id:
            return "test"
        if self.request_text:
            return "text"
        return "wrike"


class GitHubAccountConfig(BaseModel):
    account: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9-]+$")
    ssh_key_path: str = Field(min_length=1, max_length=2_000)


class GitHubAccountView(GitHubAccountConfig):
    key_available: bool


class DesignProviderConfig(BaseModel):
    provider: DesignProviderName


class DesignProviderView(DesignProviderConfig):
    availability: dict[DesignProviderName, bool]


class DesignReview(BaseModel):
    action: ReviewAction
    feedback: str | None = Field(default=None, max_length=10_000)


class PullRequestUpdate(BaseModel):
    merged: bool
    feedback: str | None = Field(default=None, max_length=10_000)


class DesignVersion(BaseModel):
    version: int
    markdown: str
    feedback: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class WorkflowEvent(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    workflow_id: UUID
    kind: str
    message: str
    phase: WorkflowPhase
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class WorkflowSummary(BaseModel):
    id: UUID
    thread_id: str
    wrike_url: str
    title: str | None = None
    phase: WorkflowPhase
    current_design_version: int = 0
    approved_design_version: int | None = None
    pull_request_url: str | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class WorkflowDetail(WorkflowSummary):
    designs: list[DesignVersion] = Field(default_factory=list)
    events: list[WorkflowEvent] = Field(default_factory=list)
    state: dict[str, Any] = Field(default_factory=dict)

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Ticket:
    external_id: str
    url: str
    title: str
    description: str
    acceptance_criteria: list[str]


@dataclass(frozen=True)
class Repository:
    clone_url: str
    default_branch: str
    local_path: str | None = None


@dataclass(frozen=True)
class PullRequest:
    number: int
    url: str
    head_sha: str


@dataclass(frozen=True)
class Deployment:
    run_id: str
    url: str
    environment: str
    revision: str
    status: str


class TicketProvider(Protocol):
    async def resolve(self, permalink: str) -> Ticket: ...
    async def add_comment(self, external_id: str, body: str, idempotency_key: str) -> None: ...


class RepositoryProvider(Protocol):
    async def resolve_for_ticket(self, ticket: Ticket) -> Repository: ...


class GitProvider(Protocol):
    async def create_pull_request(
        self, repository: Repository, branch: str, body: str, idempotency_key: str
    ) -> PullRequest: ...


class DeploymentProvider(Protocol):
    async def find_for_commit(self, repository: Repository, commit: str) -> Deployment: ...

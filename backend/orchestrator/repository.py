from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from orchestrator.domain import (
    DesignVersion,
    WorkflowDetail,
    WorkflowEvent,
    WorkflowPhase,
    WorkflowSummary,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY,
    thread_id TEXT UNIQUE NOT NULL,
    wrike_url TEXT NOT NULL,
    title TEXT,
    phase TEXT NOT NULL,
    current_design_version INTEGER NOT NULL DEFAULT 0,
    approved_design_version INTEGER,
    pull_request_url TEXT,
    error TEXT,
    scenario JSONB NOT NULL DEFAULT '{}',
    state JSONB NOT NULL DEFAULT '{}',
    initial_input JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS design_versions (
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    markdown TEXT NOT NULL,
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workflow_id, version)
);
CREATE TABLE IF NOT EXISTS workflow_events (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    phase TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_events_workflow_created
    ON workflow_events(workflow_id, created_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
    operation TEXT NOT NULL,
    key TEXT NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (operation, key)
);
CREATE TABLE IF NOT EXISTS github_accounts (
    account TEXT PRIMARY KEY,
    ssh_key_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS application_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS initial_input JSONB NOT NULL DEFAULT '{}';
ALTER TABLE github_accounts ADD COLUMN IF NOT EXISTS pat_token TEXT;
ALTER TABLE github_accounts ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '';
"""


class WorkflowRepository:
    def __init__(self, connection: AsyncConnection[Any]) -> None:
        self.connection = connection

    async def setup(self) -> None:
        async with self.connection.cursor() as cursor:
            for statement in SCHEMA.split(";"):
                if statement.strip():
                    await cursor.execute(statement)
        await self.connection.commit()

    async def create(
        self,
        workflow_id: UUID,
        url: str,
        scenario: dict[str, Any],
        initial_input: dict[str, Any],
    ) -> None:
        await self.connection.execute(
            """INSERT INTO workflows(id, thread_id, wrike_url, phase, scenario, initial_input)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (
                workflow_id,
                str(workflow_id),
                url,
                WorkflowPhase.INGESTING,
                json.dumps(scenario),
                json.dumps(initial_input),
            ),
        )
        await self.connection.commit()

    async def get_initial_input(self, workflow_id: UUID) -> dict[str, Any] | None:
        row = await self._fetchone(
            "SELECT initial_input FROM workflows WHERE id=%s", (workflow_id,)
        )
        return row["initial_input"] if row else None

    async def reset(self, workflow_id: UUID, scenario: dict[str, Any]) -> None:
        await self.connection.execute(
            "DELETE FROM design_versions WHERE workflow_id=%s", (workflow_id,)
        )
        await self.connection.execute(
            "DELETE FROM workflow_events WHERE workflow_id=%s", (workflow_id,)
        )
        await self.connection.execute(
            """UPDATE workflows
               SET title=NULL, phase=%s, current_design_version=0,
                   approved_design_version=NULL, pull_request_url=NULL, error=NULL,
                   scenario=%s, state='{}'::jsonb, updated_at=now()
               WHERE id=%s""",
            (WorkflowPhase.INGESTING, json.dumps(scenario), workflow_id),
        )
        await self.connection.commit()

    async def delete(self, workflow_id: UUID) -> None:
        await self.connection.execute("DELETE FROM workflows WHERE id=%s", (workflow_id,))
        await self.connection.commit()

    async def update(
        self,
        workflow_id: UUID,
        *,
        phase: WorkflowPhase,
        title: str | None = None,
        state: dict[str, Any] | None = None,
        design_version: int | None = None,
        approved_version: int | None = None,
        pull_request_url: str | None = None,
        error: str | None = None,
    ) -> None:
        await self.connection.execute(
            """UPDATE workflows SET phase=%s, title=COALESCE(%s, title),
               state=COALESCE(%s, state),
               current_design_version=COALESCE(%s, current_design_version),
               approved_design_version=COALESCE(%s, approved_design_version),
               pull_request_url=COALESCE(%s, pull_request_url), error=%s, updated_at=now()
               WHERE id=%s""",
            (
                phase,
                title,
                json.dumps(state) if state is not None else None,
                design_version,
                approved_version,
                pull_request_url,
                error,
                workflow_id,
            ),
        )
        await self.connection.commit()

    async def add_design(self, workflow_id: UUID, design: DesignVersion) -> None:
        await self.connection.execute(
            """INSERT INTO design_versions(workflow_id, version, markdown, feedback, created_at)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (workflow_id, design.version, design.markdown, design.feedback, design.created_at),
        )
        await self.connection.commit()

    async def add_event(self, event: WorkflowEvent) -> None:
        await self.connection.execute(
            """INSERT INTO workflow_events(id, workflow_id, kind, message, phase, data, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                event.id,
                event.workflow_id,
                event.kind,
                event.message,
                event.phase,
                json.dumps(event.data),
                event.created_at,
            ),
        )
        await self.connection.commit()

    async def upsert_github_account(
        self, account: str, ssh_key_path: str, pat_token: str | None = None, username: str = ""
    ) -> None:
        await self.connection.execute(
            """INSERT INTO github_accounts(account, ssh_key_path, pat_token, username)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (account) DO UPDATE
               SET ssh_key_path=EXCLUDED.ssh_key_path, pat_token=EXCLUDED.pat_token,
                   username=EXCLUDED.username, updated_at=now()""",
            (account.lower(), ssh_key_path, pat_token, username),
        )
        await self.connection.commit()

    async def list_github_accounts(self) -> Sequence[dict[str, Any]]:
        return await self._fetchall(
            "SELECT account, ssh_key_path, username, (pat_token IS NOT NULL) AS pat_configured "
            "FROM github_accounts ORDER BY account"
        )

    async def get_github_credentials(self, account: str) -> dict[str, Any] | None:
        return await self._fetchone(
            "SELECT ssh_key_path, pat_token, username FROM github_accounts WHERE account=%s",
            (account.lower(),),
        )

    async def get_github_key_path(self, account: str) -> str | None:
        row = await self._fetchone(
            "SELECT ssh_key_path FROM github_accounts WHERE account=%s", (account.lower(),)
        )
        return row["ssh_key_path"] if row else None

    async def delete_github_account(self, account: str) -> None:
        await self.connection.execute(
            "DELETE FROM github_accounts WHERE account=%s", (account.lower(),)
        )
        await self.connection.commit()

    async def get_setting(self, key: str, default: str) -> str:
        row = await self._fetchone("SELECT value FROM application_settings WHERE key=%s", (key,))
        return row["value"] if row else default

    async def set_setting(self, key: str, value: str) -> None:
        await self.connection.execute(
            """INSERT INTO application_settings(key, value) VALUES (%s, %s)
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()""",
            (key, value),
        )
        await self.connection.commit()

    async def list_workflows(self) -> Sequence[WorkflowSummary]:
        rows = await self._fetchall("SELECT * FROM workflows ORDER BY created_at DESC")
        return [self._summary(row) for row in rows]

    async def get(self, workflow_id: UUID) -> WorkflowDetail | None:
        row = await self._fetchone("SELECT * FROM workflows WHERE id=%s", (workflow_id,))
        if row is None:
            return None
        designs = await self._fetchall(
            "SELECT * FROM design_versions WHERE workflow_id=%s ORDER BY version DESC",
            (workflow_id,),
        )
        events = await self._fetchall(
            "SELECT * FROM workflow_events WHERE workflow_id=%s ORDER BY created_at",
            (workflow_id,),
        )
        return WorkflowDetail(
            **self._summary(row).model_dump(),
            designs=[
                DesignVersion(**{k: d[k] for k in DesignVersion.model_fields}) for d in designs
            ],
            events=[WorkflowEvent(**{k: e[k] for k in WorkflowEvent.model_fields}) for e in events],
            state=row["state"],
        )

    async def _fetchone(self, query: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        async with self.connection.cursor(row_factory=dict_row) as cursor:
            await cursor.execute(query, params)
            return await cursor.fetchone()

    async def _fetchall(self, query: str, params: tuple[Any, ...] = ()) -> Sequence[dict[str, Any]]:
        async with self.connection.cursor(row_factory=dict_row) as cursor:
            await cursor.execute(query, params)
            return await cursor.fetchall()

    @staticmethod
    def _summary(row: dict[str, Any]) -> WorkflowSummary:
        keys = WorkflowSummary.model_fields
        return WorkflowSummary(**{key: row[key] for key in keys})

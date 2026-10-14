# Architecture

## Milestone 1 scope

This iteration proves durable orchestration, explicit human gates, audit history, and a usable local
control surface. Repository inspection, design generation, implementation, commit, and branch push
are real. The selected local Codex or Claude Code CLI reads the checkout, returns the design, and
implements it after approval.
Their contracts live under `orchestrator.providers`; subsequent milestones replace one provider at a
time without changing workflow policy.

```text
React UI ──HTTP/SSE── FastAPI ── WorkflowService ── LangGraph StateGraph
                              │                 ├── PostgreSQL checkpoints
                              └── query model   └── provider interfaces
                                  (PostgreSQL)
```

LangGraph checkpoints are the source of truth for executable graph position. The relational query
model stores summaries, immutable design versions, and audit events for the UI. Large artifacts will
live in `artifacts/` (or a later object store) and be referenced from state.

## Workflow policy

The graph pauses via `interrupt()` for design approval and PR merge confirmation. Approval resumes the
same `thread_id`; restart does not bypass either gate. Requested design changes loop back through design
generation and increment the version. Test and review failures use a bounded development loop.

External side effects will use the `idempotency_keys` table before real providers are enabled. Secrets
are settings injected into providers and must never be copied into prompts, events, or artifact logs.

## Trust boundaries

- Ticket text, repository content, tool output, and CI logs are untrusted data, never policy.
- Agent command execution will be placed in per-workflow containers with explicit mounts and network
  policy in Milestone 3.
- API calls require a bearer token; GitHub webhooks require HMAC-SHA256 signatures.
- Relay has no production deployment authority.

## Extension points

- `TicketProvider`: permalink/legacy ID resolution, task retrieval, comments.
- `RepositoryProvider`: project mapping and repository discovery.
- `GitProvider`: isolated worktree lifecycle and pull requests.
- `CliDesignProvider`: read-only Codex or Claude Code subprocess execution selected in application
  settings, with bounded runtime and required-section validation.
- `CliDevelopmentProvider`: writable implementation by the same CLI after approval, followed by a
  Relay-owned commit and SSH push. Relay provides a compare link; PR creation and merge remain human
  actions.

# Relay — AI Software Engineering Orchestrator

Relay is a local-first FastAPI, LangGraph, PostgreSQL, and React application that turns a Wrike task
into a durable, human-governed software delivery workflow.

This repository implements a working orchestration skeleton with CLI-generated AI designs,
versioned design review, persistent human-in-the-loop interrupts, AI implementation, branch pushes,
PR merge confirmation, audit events, and a responsive UI.

## Prerequisites

- macOS (the target environment) with Docker Desktop
- Python 3.12+
- Node.js 22+ and npm
- At least one authenticated design CLI: OpenAI Codex (`codex`) or Claude Code (`claude`)

## Run with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL, the FastAPI backend, and the React frontend. Open
`http://localhost:5173`. Stop the stack with `docker compose down`; named volumes preserve database
data, workspaces, generated artifacts, and AI CLI login state.

The backend image includes Codex and Claude Code. Authenticate the provider you want to use once:

```bash
docker compose exec backend codex login
# or
docker compose exec backend claude
```

Set `SSH_KEY_DIR` in `.env` to the host directory containing the private keys configured in Relay.
Inside the backend container those files are available under `/root/.ssh`, so configure an account
with a path such as `/root/.ssh/id_ed25519`. The native SSH-key file picker is unavailable in the
container; enter the container path manually. The development bearer token is represented in
`.env.example`; replace it before using the application outside a single-user local machine.

For a credential-free test, select **Test issue** in the start form and enter an identifier such as
`DEMO-123`. This creates an explicitly marked local mock workflow without contacting Wrike.

You can also select **Text** and provide the engineering request directly. Text is a first-class workflow
source: its contents become the normalized ticket description and are carried into the design report.
A project or repository such as `acme/billing-service` or a Git clone URL is required for text input.
The repository is cloned and inspected read-only for design generation. After approval, the selected
agent implements the design in that checkout.

## AI design provider

Open **Settings → AI design provider** and select OpenAI Codex or Claude Code. The backend launches
the selected CLI in non-interactive, read-only mode from the cloned repository. Sign in through the
CLI itself before starting a workflow; Relay does not store an OpenAI or Anthropic API key. Designs
must contain the seven required functional and technical sections or the workflow fails with a
diagnostic instead of accepting malformed output.

Codex is the default. Install and authenticate it, then verify `codex --version` works in the same
environment that starts the backend. For Claude Code, verify `claude --version` instead. Generation
times out after `DESIGN_GENERATION_TIMEOUT_SECONDS` (300 seconds by default).

After design approval, the same selected CLI checks out a `relay/<workflow>` feature branch,
implements the approved design, adds tests, and runs the repository's relevant checks. Relay then
commits all changes and pushes the branch with the configured GitHub SSH key. Relay then provides a
GitHub compare link where you create and review the pull request yourself. Implementation is bounded
by `IMPLEMENTATION_TIMEOUT_SECONDS` (1,800 seconds by default), and Relay never creates or merges the
pull request.

On Windows, Codex requires its optional code-mode host for `workspace-write`. Relay discovers the
helper shipped alongside the selected Codex executable and supplies its path to the child process.
You can override discovery by setting `CODEX_CODE_MODE_HOST_PATH` to
`codex-code-mode-host.exe` before starting the backend.

## GitHub authentication status

Repository analysis connects to GitHub over SSH. Open **Settings → GitHub accounts** and map an owner
such as `tcbenkhard` to a private-key path such as `/Users/me/.ssh/id_ed25519_tcbenkhard`. Given
`https://github.com/tcbenkhard/advent-of-code-2020`, the owner selects that key. The application stores
only the path and passes it to the isolated Git process with `IdentitiesOnly=yes`; key contents never
enter graph state, prompts, or audit logs. GitHub host keys use a workspace-specific `known_hosts` file
with trust-on-first-use (`StrictHostKeyChecking=accept-new`).

The Settings form includes a native **Browse** button. It opens in the backend user's home directory on
macOS and Windows and filters for extensionless OpenSSH keys plus `.pem`, `.key`, and `.priv`. Public
`.pub` files and PuTTY `.ppk` files are rejected because they cannot be used directly by OpenSSH.

The checkout is a shallow clone under `workspaces/<workflow-id>/repository` and is inspected without
executing repository code during analysis. The GitHub webhook endpoint verifies
`X-Hub-Signature-256` using `WEBHOOK_SECRET`. Later outbound API operations
should use a repository-scoped GitHub App installation token rather than reusing the SSH key.

## Exercise failure paths

The API accepts a `mock_scenario` on `POST /api/workflows`:

```json
{
  "wrike_url": "https://www.wrike.com/open.htm?id=12345",
  "mock_scenario": {
    "test_failures_before_success": 1,
    "review_findings_before_success": 0
  }
}
```

Design revision and PR feedback paths are available directly in the UI.

## Quality checks

```bash
pytest
ruff check backend
mypy
cd frontend && npm run build && npm run lint && npm test
```

See [docs/architecture.md](docs/architecture.md) for persistence, trust boundaries, and extension points.

From workflow detail, **Restart** resets the same workflow ID and thread to intake from its original
input, clearing its prior run data and workspace. **Retry failed step** instead resumes the exact
pending LangGraph node from its durable checkpoint, preserving the approved design, checkout, branch,
and completed work. **Remove** permanently deletes the workflow records, checkpoint history, and
`workspaces/<workflow-id>` checkout after browser confirmation.

## Deliberately deferred

Real Wrike permalink resolution, coding containers, GitHub pull requests,
webhook-driven CI/CD tracking, smoke tests, credential settings, and Wrike reporting belong to
Milestones 2–5. No production resources or credentials are created by this milestone.

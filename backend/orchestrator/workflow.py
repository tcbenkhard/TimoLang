from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from orchestrator.domain import WorkflowPhase


class OrchestratorState(TypedDict, total=False):
    workflow_id: str
    execution_id: str
    wrike_url: str
    ticket: dict[str, Any]
    repository: dict[str, Any]
    phase: str
    design_version: int
    design_markdown: str
    design_feedback: str
    approved_design_version: int
    development_iteration: int
    test_failures: int
    review_findings: int
    review_markdown: str
    review_iteration: int
    branch: str
    commit_sha: str
    pull_request_url: str
    final_report: str
    scenario: dict[str, Any]
    source_kind: str
    request_text: str
    requested_project: str
    error: str


def ingest_ticket(state: OrchestratorState) -> dict[str, Any]:
    # Milestone 1 deliberately resolves through a deterministic mock provider.
    task_key = state["wrike_url"].rstrip("/").split("/")[-1]
    is_text = state.get("source_kind") == "text"
    description = state.get("request_text") or "Demonstrate the durable orchestration workflow."
    first_line = next(
        (line.strip() for line in description.splitlines() if line.strip()), "Request"
    )
    title = first_line[:97] + "…" if len(first_line) > 98 else first_line
    stated_criteria = [
        line.lstrip("-* ").strip()
        for line in description.splitlines()
        if line.lstrip().startswith(("-", "*")) and line.lstrip("-* ").strip()
    ]
    return {
        "ticket": {
            "id": "USER-TEXT" if is_text else task_key,
            "title": (
                title
                if is_text
                else (
                    f"Test issue {task_key.removeprefix('TEST-')}"
                    if state.get("source_kind") == "test"
                    else f"Mock Wrike task {task_key}"
                )
            ),
            "description": description,
            "acceptance_criteria": stated_criteria
            or ["The supplied request is implemented and verified in the selected repository"],
            "source": state.get("source_kind", "wrike"),
        },
        "phase": WorkflowPhase.INGESTING,
    }


def resolve_repository(state: OrchestratorState) -> dict[str, Any]:
    requested = state.get("requested_project")
    name = requested or "configured/example-service"
    clone_url = (
        requested
        if requested and requested.startswith(("https://", "git@"))
        else f"https://github.com/{name.removesuffix('.git')}.git"
    )
    return {
        "repository": {
            "name": name,
            "clone_url": clone_url,
            "base_branch": "main",
        },
        "phase": WorkflowPhase.ANALYZING,
    }


def await_design_approval(state: OrchestratorState) -> dict[str, Any]:
    response = interrupt(
        {
            "kind": "design_review",
            "version": state["design_version"],
            "markdown": state["design_markdown"],
            "actions": ["approve", "request_changes", "reject"],
        }
    )
    action = response.get("action")
    if action == "approve":
        return {
            "phase": WorkflowPhase.DEVELOPING,
            "approved_design_version": state["design_version"],
            "design_feedback": "",
        }
    if action == "request_changes":
        return {
            "phase": WorkflowPhase.DESIGNING,
            "design_feedback": response.get("feedback", "No details supplied"),
        }
    return {"phase": WorkflowPhase.CANCELLED}


def route_design_review(state: OrchestratorState) -> Literal["revise", "develop", "cancel"]:
    if state["phase"] == WorkflowPhase.DESIGNING:
        return "revise"
    if state["phase"] == WorkflowPhase.DEVELOPING:
        return "develop"
    return "cancel"


def route_code_review(state: OrchestratorState) -> Literal["correct", "pr"]:
    if state.get("test_failures") or state.get("review_findings"):
        return "correct"
    return "pr"


def await_pull_request_merge(_: OrchestratorState) -> dict[str, Any]:
    response = interrupt(
        {
            "kind": "pull_request_merge",
            "message": "Confirm the PR was merged, or return review feedback.",
        }
    )
    if response.get("merged"):
        return {"phase": WorkflowPhase.REPORTING}
    return {
        "phase": WorkflowPhase.DEVELOPING,
        "design_feedback": response.get("feedback", "PR changes requested"),
    }


def route_pr(state: OrchestratorState) -> Literal["report", "develop"]:
    return "report" if state["phase"] == WorkflowPhase.REPORTING else "develop"


def generate_final_report(state: OrchestratorState) -> dict[str, Any]:
    report = f"""# Final report

- Ticket: {state["wrike_url"]}
- Repository: {state["repository"]["name"]}
- Approved design: v{state["approved_design_version"]}
- Commit: `{state["commit_sha"]}`
- Pull request creation link: {state["pull_request_url"]}
"""
    return {"phase": WorkflowPhase.SUCCEEDED, "final_report": report}


def build_workflow(
    checkpointer: Any,
    design_generation: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    implementation: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    code_review: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    pull_request_preparation: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    repository_access: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
) -> Any:
    graph = StateGraph(OrchestratorState)
    graph.add_node("ingest_ticket", ingest_ticket)
    graph.add_node("resolve_repository", repository_access or resolve_repository)
    graph.add_node("design_solution", design_generation)
    graph.add_node("await_design_approval", await_design_approval)
    graph.add_node("implement_solution", implementation)
    graph.add_node("review_solution", code_review)
    graph.add_node("correct_review_findings", implementation)
    graph.add_node("implement_pr_feedback", implementation)
    graph.add_node("prepare_pull_request", pull_request_preparation)
    graph.add_node("await_pull_request_merge", await_pull_request_merge)
    graph.add_node("generate_final_report", generate_final_report)

    graph.add_edge(START, "ingest_ticket")
    graph.add_edge("ingest_ticket", "resolve_repository")
    graph.add_edge("resolve_repository", "design_solution")
    graph.add_edge("design_solution", "await_design_approval")
    graph.add_conditional_edges(
        "await_design_approval",
        route_design_review,
        {"revise": "design_solution", "develop": "implement_solution", "cancel": END},
    )
    graph.add_edge("implement_solution", "review_solution")
    graph.add_conditional_edges(
        "review_solution",
        route_code_review,
        {"correct": "correct_review_findings", "pr": "prepare_pull_request"},
    )
    graph.add_edge("correct_review_findings", "prepare_pull_request")
    graph.add_edge("prepare_pull_request", "await_pull_request_merge")
    graph.add_conditional_edges(
        "await_pull_request_merge",
        route_pr,
        {"report": "generate_final_report", "develop": "implement_pr_feedback"},
    )
    graph.add_edge("implement_pr_feedback", "prepare_pull_request")
    graph.add_edge("generate_final_report", END)
    return graph.compile(checkpointer=checkpointer)

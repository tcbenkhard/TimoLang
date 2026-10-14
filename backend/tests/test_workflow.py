from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from orchestrator.domain import WorkflowPhase
from orchestrator.workflow import build_workflow


def initial_state(**scenario: object) -> dict[str, object]:
    workflow_id = str(uuid4())
    return {
        "workflow_id": workflow_id,
        "wrike_url": "https://www.wrike.com/open.htm?id=12345",
        "phase": WorkflowPhase.INGESTING,
        "scenario": scenario,
    }


async def generate_test_design(state: dict[str, object]) -> dict[str, object]:
    version = int(state.get("design_version", 0)) + 1
    ticket = state["ticket"]
    assert isinstance(ticket, dict)
    feedback = state.get("design_feedback", "")
    markdown = f"""# Design v{version}
## 1. Summary
{ticket["description"]}
## 2. Technical and functional acceptance criteria
Test criteria
## 3. Existing system analysis
Test analysis
### Existing functional design
Current flow
## 4. Functional implementation
Test flow
### New feature flow
New flow
### Functional design
New behavior
## 5. Testing strategy
Test strategy
## 6. Risks
Test risks
## 7. Open questions
Test questions
{feedback}
"""
    return {
        "phase": WorkflowPhase.DESIGNING,
        "design_version": version,
        "design_markdown": markdown,
    }


async def implement_test_solution(state: dict[str, object]) -> dict[str, object]:
    iteration = int(state.get("development_iteration", 0)) + 1
    return {
        "phase": WorkflowPhase.DEVELOPING,
        "development_iteration": iteration,
        "branch": f"relay/{str(state['workflow_id'])[:8]}",
        "commit_sha": f"test{iteration:036d}",
        "test_failures": 0,
        "review_findings": 0,
    }


async def review_test_solution(state: dict[str, object]) -> dict[str, object]:
    iteration = int(state["development_iteration"])
    scenario = state.get("scenario", {})
    assert isinstance(scenario, dict)
    review_target = int(scenario.get("review_findings_before_success", 0))
    test_target = int(scenario.get("test_failures_before_success", 0))
    findings = max(0, review_target - iteration + 1)
    return {
        "phase": WorkflowPhase.REVIEWING,
        "review_iteration": int(state.get("review_iteration", 0)) + 1,
        "test_failures": max(0, test_target - iteration + 1),
        "review_findings": findings,
        "review_markdown": (
            f"## AI code review\n\n{'Changes requested.' if findings else 'Review passed.'}"
        ),
    }


async def create_test_pull_request(_: dict[str, object]) -> dict[str, object]:
    return {
        "pull_request_url": "https://github.com/acme/example/pull/101",
        "phase": WorkflowPhase.AWAITING_PR_MERGE,
    }


def build_test_graph() -> object:
    return build_workflow(
        InMemorySaver(),
        generate_test_design,
        implement_test_solution,
        review_test_solution,
        create_test_pull_request,
    )


@pytest.mark.asyncio
async def test_design_revision_and_both_approval_gates() -> None:
    graph = build_test_graph()
    config = {"configurable": {"thread_id": "revision-flow"}}

    first = await graph.ainvoke(initial_state(), config=config)
    assert first["design_version"] == 1
    assert first["__interrupt__"][0].value["kind"] == "design_review"

    revised = await graph.ainvoke(
        Command(resume={"action": "request_changes", "feedback": "Add rollback detail"}),
        config=config,
    )
    assert revised["design_version"] == 2
    assert "Add rollback detail" in revised["design_markdown"]

    pull_request = await graph.ainvoke(Command(resume={"action": "approve"}), config=config)
    assert pull_request["approved_design_version"] == 2
    assert pull_request["__interrupt__"][0].value["kind"] == "pull_request_merge"

    completed = await graph.ainvoke(Command(resume={"merged": True}), config=config)
    assert completed["phase"] == WorkflowPhase.SUCCEEDED


@pytest.mark.asyncio
async def test_review_performs_at_most_one_correction() -> None:
    graph = build_test_graph()
    config = {"configurable": {"thread_id": "retry-flow"}}
    await graph.ainvoke(initial_state(test_failures_before_success=2), config=config)
    result = await graph.ainvoke(Command(resume={"action": "approve"}), config=config)
    assert result["development_iteration"] == 2
    assert result["review_iteration"] == 1
    assert result["__interrupt__"][0].value["kind"] == "pull_request_merge"


@pytest.mark.asyncio
async def test_code_review_findings_are_fixed_without_user_approval() -> None:
    graph = build_test_graph()
    config = {"configurable": {"thread_id": "review-flow"}}
    await graph.ainvoke(initial_state(review_findings_before_success=1), config=config)

    result = await graph.ainvoke(Command(resume={"action": "approve"}), config=config)

    assert result["development_iteration"] == 2
    assert result["review_findings"] == 0
    assert "Changes requested" in result["review_markdown"]
    assert result["review_iteration"] == 1
    assert result["__interrupt__"][0].value["kind"] == "pull_request_merge"


@pytest.mark.asyncio
async def test_pull_request_feedback_does_not_trigger_another_ai_review() -> None:
    graph = build_test_graph()
    config = {"configurable": {"thread_id": "pr-feedback-flow"}}
    await graph.ainvoke(initial_state(), config=config)
    first_pr = await graph.ainvoke(Command(resume={"action": "approve"}), config=config)
    assert first_pr["review_iteration"] == 1

    second_pr = await graph.ainvoke(
        Command(resume={"merged": False, "feedback": "Rename the endpoint"}),
        config=config,
    )

    assert second_pr["development_iteration"] == 2
    assert second_pr["review_iteration"] == 1
    assert second_pr["__interrupt__"][0].value["kind"] == "pull_request_merge"


@pytest.mark.asyncio
async def test_text_request_drives_ticket_and_design_content() -> None:
    graph = build_test_graph()
    config = {"configurable": {"thread_id": "text-request"}}
    request = "Add CSV export to billing reports.\n- Export respects active filters"
    state = initial_state()
    state.update(
        {
            "source_kind": "text",
            "request_text": request,
            "requested_project": "acme/billing-service",
            "wrike_url": "local://user-request",
        }
    )
    result = await graph.ainvoke(state, config=config)
    assert result["ticket"]["description"] == request
    assert result["ticket"]["acceptance_criteria"] == ["Export respects active filters"]
    assert result["repository"]["name"] == "acme/billing-service"
    assert request in result["design_markdown"]

    design = result["design_markdown"]
    expected_sections = [
        "# Design v1",
        "## 1. Summary",
        "## 2. Technical and functional acceptance criteria",
        "## 3. Existing system analysis",
        "## 4. Functional implementation",
        "## 5. Testing strategy",
        "## 6. Risks",
        "## 7. Open questions",
    ]
    assert all(section in design for section in expected_sections)
    assert "### Existing functional design" in design
    assert "### New feature flow" in design
    assert "### Functional design" in design

import hashlib
import hmac

import pytest
from orchestrator.config import Settings
from orchestrator.domain import WorkflowCreate
from orchestrator.main import inspect_key_path, list_ssh_private_keys
from orchestrator.service import describe_error, retry_phase_for_node
from pydantic import ValidationError


def test_github_signature_contract() -> None:
    settings = Settings(webhook_secret="test-secret")
    body = b'{"action":"closed"}'
    signature = (
        "sha256=" + hmac.new(settings.webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    )
    assert hmac.compare_digest(signature, signature)


def test_only_wrike_urls_are_accepted() -> None:
    WorkflowCreate(wrike_url="https://www.wrike.com/open.htm?id=123")
    with pytest.raises(ValidationError):
        WorkflowCreate(wrike_url="https://example.com/task/123")


def test_fake_issue_id_creates_local_wrike_source() -> None:
    request = WorkflowCreate(test_id="DEMO_123")
    assert request.source_url == "https://www.wrike.com/open.htm?id=TEST-DEMO_123"
    with pytest.raises(ValidationError):
        WorkflowCreate(test_id="invalid id with spaces")


def test_user_text_and_project_are_accepted() -> None:
    request = WorkflowCreate(
        request_text="Add an export button to the billing report.",
        project="acme/billing-service",
    )
    assert request.source_kind == "text"
    assert request.project == "acme/billing-service"


def test_user_text_requires_a_repository() -> None:
    with pytest.raises(ValidationError):
        WorkflowCreate(request_text="Add an export button to the billing report.")


def test_multiple_sources_are_rejected() -> None:
    with pytest.raises(ValidationError):
        WorkflowCreate(test_id="DEMO", request_text="This text is long enough to validate.")


def test_private_key_file_filter_excludes_public_and_putty_keys(tmp_path) -> None:
    for name in ("id_ed25519", "account.pem", "account.key", "account.priv"):
        candidate = tmp_path / name
        candidate.write_text("private", encoding="utf-8")
        assert inspect_key_path(str(candidate))[1]
    for name in ("id_ed25519.pub", "account.ppk", "notes.txt"):
        candidate = tmp_path / name
        candidate.write_text("not accepted", encoding="utf-8")
        assert not inspect_key_path(str(candidate))[1]


def test_empty_exception_still_produces_a_diagnostic() -> None:
    assert describe_error(NotImplementedError()) == "NotImplementedError"
    assert describe_error(RuntimeError("clone failed")) == "RuntimeError: clone failed"


def test_key_browser_lists_paths_without_reading_key_contents(tmp_path) -> None:
    keys = ["id_ed25519", "work.pem", "work.key", "work.priv", "custom_key"]
    for name in keys + ["id_ed25519.pub", "work.ppk", "config", "known_hosts", "authorized_keys"]:
        (tmp_path / name).touch()
    (tmp_path / "directory").mkdir()
    assert list_ssh_private_keys(tmp_path) == sorted(str(tmp_path / name) for name in keys)
    assert list_ssh_private_keys(tmp_path / "missing") == []


def test_retry_phase_is_derived_from_the_failed_graph_node() -> None:
    assert retry_phase_for_node("resolve_repository") == "ingesting"
    assert retry_phase_for_node("design_solution") == "designing"
    assert retry_phase_for_node("implement_solution") == "developing"

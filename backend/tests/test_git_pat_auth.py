import base64
import subprocess
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from orchestrator.domain import GitHubAccountConfig, GitHubAccountView
from orchestrator.main import app
from orchestrator.providers.development_cli import CliDevelopmentProvider, DevelopmentError
from orchestrator.providers.git_auth import git_environment, redact_git_diagnostic
from orchestrator.providers.github import GitHubRepositoryAccess
from orchestrator.repository import WorkflowRepository


class Pool:
    @asynccontextmanager
    async def connection(self):
        yield object()


def test_pat_takes_precedence_without_requiring_an_ssh_key(tmp_path, monkeypatch):
    monkeypatch.delenv("GIT_CONFIG_COUNT", raising=False)
    env = git_environment(
        {"username": "personal-user", "pat_token": "test-pat", "ssh_key_path": "/missing"},
        tmp_path,
    )
    assert env["RELAY_GIT_TRANSPORT"] == "https"
    assert env["GIT_CONFIG_KEY_0"] == "http.https://github.com/.extraheader"
    assert env["GIT_CONFIG_KEY_1"] == "credential.helper"
    assert env["GIT_CONFIG_VALUE_1"] == ""
    encoded = env["GIT_CONFIG_VALUE_0"].split()[-1]
    assert base64.b64decode(encoded) == b"personal-user:test-pat"
    assert redact_git_diagnostic(f"test-pat {encoded}", env) == "[REDACTED] [REDACTED]"


def test_ssh_remains_available_without_pat(tmp_path):
    key = tmp_path / "id_ed25519"
    key.touch()
    env = git_environment({"ssh_key_path": str(key), "pat_token": None}, tmp_path)
    assert env["RELAY_GIT_TRANSPORT"] == "ssh"
    assert str(key) in env["GIT_SSH_COMMAND"]


def test_account_models_accept_pat_only_and_do_not_return_tokens():
    config = GitHubAccountConfig(account="acme", pat_token="test-pat")
    assert config.ssh_key_path == ""
    assert "test-pat" not in repr(config)
    view = GitHubAccountView(
        account="acme", ssh_key_path="", key_available=False, pat_configured=True
    )
    assert "pat_token" not in view.model_dump()


def test_account_api_saves_pat_only_and_returns_no_secret(monkeypatch):
    save = AsyncMock()
    monkeypatch.setattr(WorkflowRepository, "upsert_github_account", save)
    app.state.pool = Pool()
    response = TestClient(app).put(
        "/api/settings/github-accounts/acme",
        headers={"Authorization": "Bearer local-development-token"},
        json={"account": "acme", "pat_token": "test-pat", "username": "personal-user"},
    )
    assert response.status_code == 200
    assert response.json()["pat_configured"] is True
    assert response.json()["username"] == "personal-user"
    assert "test-pat" not in response.text
    save.assert_awaited_once_with("acme", "", "test-pat", "personal-user")


def test_pat_save_requires_a_username():
    response = TestClient(app).put(
        "/api/settings/github-accounts/acme",
        headers={"Authorization": "Bearer local-development-token"},
        json={"account": "acme", "pat_token": "test-pat"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "GitHub username is required when using a PAT"


def test_legacy_pat_accounts_still_authenticate(tmp_path):
    env = git_environment({"pat_token": "test-pat"}, tmp_path)
    encoded = next(
        value.split()[-1] for value in env.values() if value.startswith("Authorization: Basic ")
    )
    assert base64.b64decode(encoded) == b"x-access-token:test-pat"


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "test-pat"])
async def test_clone_uses_configured_transport(tmp_path, monkeypatch, token):
    key = tmp_path / "id_ed25519"
    key.touch()
    monkeypatch.setattr(
        WorkflowRepository,
        "get_github_credentials",
        AsyncMock(
            return_value={"username": "personal-user", "pat_token": token, "ssh_key_path": str(key)}
        ),
    )
    access = GitHubRepositoryAccess(Pool(), tmp_path)
    clone = AsyncMock()
    monkeypatch.setattr(access, "_git_clone", clone)
    monkeypatch.setattr(access, "_inspect", lambda _: {"default_branch": "main"})
    result = await access.resolve_and_inspect(
        {"workflow_id": "example", "requested_project": "acme/reports"}
    )
    url = "https://github.com/acme/reports.git" if token else "git@github.com:acme/reports.git"
    assert result["repository"]["clone_url"] == url
    assert clone.await_args.args[0] == url
    if token:
        env = clone.await_args.args[2]
        header = next(value for value in env.values() if value.startswith("Authorization: Basic "))
        assert base64.b64decode(header.split()[-1]) == b"personal-user:test-pat"
    assert "test-pat" not in str(result)


@pytest.mark.asyncio
async def test_git_command_errors_redact_pat(tmp_path, monkeypatch):
    env = git_environment({"pat_token": "test-pat"}, tmp_path)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: subprocess.CompletedProcess(
            a[0], 1, "", "failed test-pat " + env["GIT_CONFIG_VALUE_0"]
        ),
    )
    provider = CliDevelopmentProvider(Pool(), tmp_path)
    with pytest.raises(DevelopmentError) as error:
        await provider._run(["git", "push"], tmp_path, env=env, command_timeout=30)
    assert "test-pat" not in str(error.value)
    assert "[REDACTED]" in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "test-pat"])
async def test_push_switches_existing_checkout_to_current_transport(tmp_path, monkeypatch, token):
    key = tmp_path / "id_ed25519"
    key.touch()
    monkeypatch.setattr(
        WorkflowRepository,
        "get_github_credentials",
        AsyncMock(
            return_value={"username": "personal-user", "pat_token": token, "ssh_key_path": str(key)}
        ),
    )
    provider = CliDevelopmentProvider(Pool(), tmp_path)
    run = AsyncMock(
        side_effect=[
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 0, "1", ""),
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 0, "commit-hash", ""),
        ]
    )
    monkeypatch.setattr(provider, "_run", run)
    result = await provider._commit_changes(
        {"repository": {"account": "acme", "name": "acme/reports", "base_branch": "main"}},
        tmp_path,
        "relay/example",
        "done",
    )
    url = "https://github.com/acme/reports.git" if token else "git@github.com:acme/reports.git"
    assert run.await_args_list[2].args[0] == ["git", "remote", "set-url", "origin", url]
    assert run.await_args_list[3].kwargs["env"]["RELAY_GIT_TRANSPORT"] == (
        "https" if token else "ssh"
    )
    assert result == "commit-hash"
    if token:
        env = run.await_args_list[3].kwargs["env"]
        header = next(value for value in env.values() if value.startswith("Authorization: Basic "))
        assert base64.b64decode(header.split()[-1]) == b"personal-user:test-pat"

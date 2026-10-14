from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any


def git_environment(credentials: dict[str, Any], workspace_root: Path) -> dict[str, str]:
    environment = os.environ.copy()
    environment["GIT_TERMINAL_PROMPT"] = "0"
    token = credentials.get("pat_token")
    environment["RELAY_GIT_TRANSPORT"] = "https" if token else "ssh"
    if token:
        # Pass credentials only to Git's process, never into remotes or repository config.
        # Existing accounts retain their previous authentication until a username is saved.
        username = credentials.get("username") or "x-access-token"
        encoded = base64.b64encode(f"{username}:{token}".encode()).decode()
        count = int(environment.get("GIT_CONFIG_COUNT", "0"))
        for key, value in (
            ("http.https://github.com/.extraheader", f"Authorization: Basic {encoded}"),
            ("credential.helper", ""),
        ):
            environment[f"GIT_CONFIG_KEY_{count}"] = key
            environment[f"GIT_CONFIG_VALUE_{count}"] = value
            count += 1
        environment["GIT_CONFIG_COUNT"] = str(count)
    else:
        key_path = Path(credentials["ssh_key_path"]).expanduser().resolve()
        if not key_path.is_file():
            raise ValueError("Configured SSH key does not exist")
        known_hosts = workspace_root / "known_hosts"
        environment["GIT_SSH_COMMAND"] = (
            f'ssh -i "{key_path}" -o IdentitiesOnly=yes '
            f'-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="{known_hosts}"'
        )
    return environment


def redact_git_diagnostic(message: str, environment: dict[str, str]) -> str:
    for index in range(int(environment.get("GIT_CONFIG_COUNT", "0"))):
        value = environment.get(f"GIT_CONFIG_VALUE_{index}", "")
        if value.startswith("Authorization: Basic "):
            encoded = value.removeprefix("Authorization: Basic ")
            token = base64.b64decode(encoded).decode().split(":", 1)[1]
            message = message.replace(encoded, "[REDACTED]").replace(token, "[REDACTED]")
    return message

from __future__ import annotations

import os
from pathlib import Path


def codex_runtime(executable: str) -> tuple[str, dict[str, str]]:
    """Select a complete Codex installation and its optional Windows helper."""
    environment = os.environ.copy()
    configured = environment.get("CODEX_CODE_MODE_HOST_PATH")
    if configured and Path(configured).is_file():
        helper = Path(configured).resolve()
        native_executable = helper.with_name("codex.exe")
        return (
            str(native_executable) if native_executable.is_file() else executable,
            environment,
        )

    if os.name != "nt":
        return executable, environment

    executable_path = Path(executable).resolve()
    relative_helper = Path(
        "@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe"
    )
    candidates: list[Path] = []
    for parent in executable_path.parents:
        candidates.extend(
            (
                parent / relative_helper,
                parent / "node_modules" / relative_helper,
                parent / "@openai" / "codex" / "node_modules" / relative_helper,
            )
        )

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        jetbrains = Path(local_app_data) / "JetBrains"
        candidates.extend(
            jetbrains.glob(
                "*/acp-agents/.runtimes/node/*/npm-cache/_npx/*/node_modules/"
                "@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/"
                "codex-code-mode-host.exe"
            )
        )
        candidates.extend(
            jetbrains.glob(
                "*/acp-agents/codex-acp/*/node_modules/@openai/"
                "codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/"
                "codex-code-mode-host.exe"
            )
        )

    app_data = os.environ.get("APPDATA")
    if app_data:
        candidates.append(
            Path(app_data)
            / "npm"
            / "node_modules"
            / "@openai"
            / "codex"
            / "node_modules"
            / relative_helper
        )

    helpers = [candidate.resolve() for candidate in candidates if candidate.is_file()]
    if not helpers:
        raise FileNotFoundError(
            "No complete Codex Windows installation was found. Relay requires "
            "codex.exe and codex-code-mode-host.exe from the same installation."
        )
    helper = max(helpers, key=lambda path: path.stat().st_mtime)
    native_executable = helper.with_name("codex.exe")
    environment["CODEX_CODE_MODE_HOST_PATH"] = str(helper)
    return (
        str(native_executable) if native_executable.is_file() else executable,
        environment,
    )

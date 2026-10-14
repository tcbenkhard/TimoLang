from pathlib import Path

from orchestrator.providers.github import GITHUB_REPOSITORY, GitHubRepositoryAccess


def test_github_repository_owner_is_derived_from_supported_inputs() -> None:
    for value in (
        "tcbenkhard/advent-of-code-2020",
        "https://github.com/tcbenkhard/advent-of-code-2020",
        "git@github.com:tcbenkhard/advent-of-code-2020.git",
    ):
        match = GITHUB_REPOSITORY.fullmatch(value)
        assert match is not None
        assert match.group("account") == "tcbenkhard"
        assert match.group("repository") == "advent-of-code-2020"


def test_repository_inspection_reads_structure_without_execution(tmp_path: Path) -> None:
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Example\nNo commands are run.", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text("[project]\nname='example'", encoding="utf-8")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("raise RuntimeError('do not run')", encoding="utf-8")

    analysis = GitHubRepositoryAccess._inspect(tmp_path)

    assert analysis["default_branch"] == "main"
    assert "pyproject.toml" in analysis["manifests"]
    assert "src/app.py" in analysis["sample_files"]
    assert "No commands are run" in analysis["readme_excerpt"]

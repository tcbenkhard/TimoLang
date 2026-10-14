from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Engineering Orchestrator"
    database_url: str = "postgresql://orchestrator:orchestrator@localhost:5432/orchestrator"
    api_token: str = "local-development-token"
    webhook_secret: str = "replace-me"
    artifact_root: Path = Path("artifacts")
    workspace_root: Path = Path("workspaces")
    max_development_iterations: int = 3
    design_generation_timeout_seconds: int = 300
    implementation_timeout_seconds: int = 1_800


@lru_cache
def get_settings() -> Settings:
    return Settings()

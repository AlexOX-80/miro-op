from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from connector.config import load_dotenv


@dataclass(frozen=True)
class AppBackendSettings:
    openproject_base_url: str
    openproject_api_token: str
    openproject_auth_mode: str
    openproject_version_name: str
    openproject_story_type: str
    miro_base_url: str
    miro_access_token: str
    miro_board_id: str
    app_public_url: str
    backend_host: str
    backend_port: int
    data_file: Path


def _require(values: dict[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ValueError(f"Missing required configuration: {key}")
    return value


def load_settings(env_file: str | None = None) -> AppBackendSettings:
    file_values: dict[str, str] = {}
    file_path = Path(env_file or ".env")
    if file_path.exists():
        file_values = load_dotenv(file_path)

    values = {**file_values, **{k: v for k, v in os.environ.items() if isinstance(v, str)}}
    return AppBackendSettings(
        openproject_base_url=_require(values, "OPENPROJECT_BASE_URL").rstrip("/"),
        openproject_api_token=_require(values, "OPENPROJECT_API_TOKEN"),
        openproject_auth_mode=values.get("OPENPROJECT_AUTH_MODE", "basic").strip().lower() or "basic",
        openproject_version_name=_require(values, "OPENPROJECT_VERSION_NAME"),
        openproject_story_type=values.get("OPENPROJECT_STORY_TYPE", "User story").strip() or "User story",
        miro_base_url=_require(values, "MIRO_BASE_URL").rstrip("/"),
        miro_access_token=_require(values, "MIRO_ACCESS_TOKEN"),
        miro_board_id=_require(values, "MIRO_BOARD_ID"),
        app_public_url=values.get("MIRO_APP_PUBLIC_URL", "http://localhost:8787").strip().rstrip("/"),
        backend_host=values.get("APP_BACKEND_HOST", "127.0.0.1").strip() or "127.0.0.1",
        backend_port=int(values.get("APP_BACKEND_PORT", "8787")),
        data_file=Path(values.get("APP_DATA_FILE", ".data/app_card_links.json").strip()),
    )

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ConnectorConfig:
    openproject_base_url: str
    openproject_api_token: str
    openproject_auth_mode: str
    openproject_version_name: str
    openproject_story_type: str
    miro_base_url: str
    miro_access_token: str
    miro_board_id: str
    miro_assignee_map: dict[str, str]
    miro_columns: dict[str, dict[str, int]]
    miro_card_vertical_spacing: int


def load_dotenv(env_file: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_file.exists():
        raise FileNotFoundError(f"Env file not found: {env_file}")

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator:
            continue
        values[key.strip()] = value.strip()
    return values


def _require(values: dict[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ValueError(f"Missing required configuration: {key}")
    return value


def load_config(env_file: str | None) -> ConnectorConfig:
    file_path = Path(env_file or ".env")
    values = load_dotenv(file_path)
    columns = json.loads(_require(values, "MIRO_COLUMNS_JSON"))

    return ConnectorConfig(
        openproject_base_url=_require(values, "OPENPROJECT_BASE_URL").rstrip("/"),
        openproject_api_token=_require(values, "OPENPROJECT_API_TOKEN"),
        openproject_auth_mode=values.get("OPENPROJECT_AUTH_MODE", "basic").strip().lower() or "basic",
        openproject_version_name=_require(values, "OPENPROJECT_VERSION_NAME"),
        openproject_story_type=values.get("OPENPROJECT_STORY_TYPE", "User story").strip() or "User story",
        miro_base_url=_require(values, "MIRO_BASE_URL").rstrip("/"),
        miro_access_token=_require(values, "MIRO_ACCESS_TOKEN"),
        miro_board_id=_require(values, "MIRO_BOARD_ID"),
        miro_assignee_map=json.loads(values.get("MIRO_ASSIGNEE_MAP_JSON", "{}")),
        miro_columns=columns,
        miro_card_vertical_spacing=int(values.get("MIRO_CARD_VERTICAL_SPACING", "260")),
    )

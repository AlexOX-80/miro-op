from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class AppCardLink:
    app_card_id: str
    work_package_id: int
    board_id: str
    created_at: str
    updated_at: str


class LinkStore:
    def __init__(self, data_file: Path) -> None:
        self.data_file = data_file
        self.data_file.parent.mkdir(parents=True, exist_ok=True)

    def save_link(self, app_card_id: str, work_package_id: int, board_id: str) -> AppCardLink:
        payload = self._read()
        now = datetime.now(timezone.utc).isoformat()
        existing = payload.get(app_card_id)
        created_at = existing.get("created_at", now) if existing else now
        payload[app_card_id] = {
            "work_package_id": work_package_id,
            "board_id": board_id,
            "created_at": created_at,
            "updated_at": now,
        }
        self._write(payload)
        return AppCardLink(
            app_card_id=app_card_id,
            work_package_id=work_package_id,
            board_id=board_id,
            created_at=created_at,
            updated_at=now,
        )

    def get_link(self, app_card_id: str) -> AppCardLink | None:
        payload = self._read()
        item = payload.get(app_card_id)
        if not item:
            return None
        return AppCardLink(
            app_card_id=app_card_id,
            work_package_id=int(item["work_package_id"]),
            board_id=str(item["board_id"]),
            created_at=str(item["created_at"]),
            updated_at=str(item["updated_at"]),
        )

    def list_links(self) -> list[AppCardLink]:
        payload = self._read()
        return [
            AppCardLink(
                app_card_id=app_card_id,
                work_package_id=int(item["work_package_id"]),
                board_id=str(item["board_id"]),
                created_at=str(item["created_at"]),
                updated_at=str(item["updated_at"]),
            )
            for app_card_id, item in payload.items()
        ]

    def _read(self) -> dict[str, dict[str, str | int]]:
        if not self.data_file.exists():
            return {}
        return json.loads(self.data_file.read_text(encoding="utf-8"))

    def _write(self, payload: dict[str, dict[str, str | int]]) -> None:
        self.data_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class TokenStore:
    def __init__(self, data_file: Path) -> None:
        self.data_file = data_file
        self.data_file.parent.mkdir(parents=True, exist_ok=True)

    def save_token(self, access_token: str) -> None:
        self.data_file.write_text(json.dumps({"access_token": access_token}, indent=2), encoding="utf-8")

    def get_token(self) -> str | None:
        if not self.data_file.exists():
            return None
        payload = json.loads(self.data_file.read_text(encoding="utf-8"))
        token = payload.get("access_token")
        return str(token) if token else None

    def has_token(self) -> bool:
        return self.get_token() is not None

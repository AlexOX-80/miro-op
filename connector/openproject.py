from __future__ import annotations

import base64
import json
from typing import Any

from .http import HttpClient
from .models import Story


class OpenProjectClient:
    def __init__(self, base_url: str, api_token: str, auth_mode: str = "basic") -> None:
        self.base_url = base_url.rstrip("/")
        self.auth_mode = auth_mode
        self.http = HttpClient(
            base_url=self.base_url,
            default_headers={
                "Accept": "application/json",
                "Authorization": self._build_auth_header(api_token, auth_mode),
            },
        )

    def _build_auth_header(self, api_token: str, auth_mode: str) -> str:
        mode = auth_mode.strip().lower()
        if mode == "bearer":
            return f"Bearer {api_token}"
        if mode == "basic":
            raw = f"apikey:{api_token}".encode("utf-8")
            encoded = base64.b64encode(raw).decode("ascii")
            return f"Basic {encoded}"
        raise ValueError(
            f"Unsupported OpenProject auth mode '{auth_mode}'. Use 'basic' or 'bearer'."
        )

    def fetch_stories_for_version(self, version_name: str, story_type: str) -> list[Story]:
        type_id = self._resolve_type_id(story_type)
        version_id = self._resolve_version_id(version_name)
        filters = [
            {"type": {"operator": "=", "values": [str(type_id)]}},
            {"version": {"operator": "=", "values": [str(version_id)]}},
        ]
        stories: list[Story] = []
        offset = 1

        while True:
            response = self.http.get_json(
                "/api/v3/work_packages",
                query={
                    "filters": json.dumps(filters),
                    "pageSize": 500,
                    "offset": offset,
                },
            )
            elements = response.get("_embedded", {}).get("elements", [])
            for element in elements:
                stories.append(self._parse_story(element))

            count = int(response.get("count", len(elements)))
            total = int(response.get("total", len(stories)))
            if not elements or offset + count > total:
                break
            offset += count
        return stories

    def fetch_story(self, work_package_id: int) -> Story:
        response = self.http.get_json(f"/api/v3/work_packages/{work_package_id}")
        return self._parse_story(response)

    def _resolve_type_id(self, type_name: str) -> int:
        response = self.http.get_json("/api/v3/types")
        for element in response.get("_embedded", {}).get("elements", []):
            if element.get("name") == type_name:
                return int(element["id"])
        raise ValueError(f"OpenProject type not found: {type_name}")

    def _resolve_version_id(self, version_name: str) -> int:
        offset = 1
        while True:
            response = self.http.get_json(
                "/api/v3/versions",
                query={"pageSize": 500, "offset": offset},
            )
            elements = response.get("_embedded", {}).get("elements", [])
            for element in elements:
                if element.get("name") == version_name:
                    return int(element["id"])

            count = int(response.get("count", len(elements)))
            total = int(response.get("total", len(elements)))
            if not elements or offset + count > total:
                break
            offset += count

        raise ValueError(f"OpenProject version not found: {version_name}")

    def _parse_story(self, payload: dict[str, Any]) -> Story:
        embedded = payload.get("_embedded", {})
        description = payload.get("description")
        if isinstance(description, dict):
            description = description.get("raw") or description.get("html")
        href = payload.get("_links", {}).get("self", {}).get("href")
        permalink = None
        if href:
            permalink = href if href.startswith("http") else f"{self.base_url}{href}"
        ui_href = payload.get("_links", {}).get("showItem", {}).get("href")
        if not ui_href:
            ui_href = f"/work_packages/{payload['id']}"
        ui_link = ui_href if ui_href.startswith("http") else f"{self.base_url}{ui_href}"

        return Story(
            id=int(payload["id"]),
            subject=payload.get("subject", f"WP-{payload['id']}"),
            status_name=(
                embedded.get("status", {}).get("name")
                or payload.get("_links", {}).get("status", {}).get("title")
                or "Unknown"
            ),
            priority_name=payload.get("_links", {}).get("priority", {}).get("title"),
            assignee_id=self._extract_user_id(payload.get("_links", {}).get("assignee", {}).get("href")),
            assignee_name=payload.get("_links", {}).get("assignee", {}).get("title"),
            project_name=embedded.get("project", {}).get("name", "Unknown project"),
            version_name=embedded.get("version", {}).get("name", ""),
            description=description,
            permalink=permalink,
            ui_link=ui_link,
            due_date=payload.get("dueDate"),
            start_date=payload.get("startDate"),
        )

    def _extract_user_id(self, href: str | None) -> int | None:
        if not href:
            return None
        try:
            return int(str(href).rstrip("/").split("/")[-1])
        except (TypeError, ValueError):
            return None

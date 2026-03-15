from __future__ import annotations

import base64
import json
from typing import Any

from .http import HttpClient
from .models import Comment, Story


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

    def fetch_recent_versions(self, limit: int = 5) -> list[dict[str, Any]]:
        versions: list[dict[str, Any]] = []
        offset = 1

        while True:
            response = self.http.get_json(
                "/api/v3/versions",
                query={"pageSize": 500, "offset": offset},
            )
            elements = response.get("_embedded", {}).get("elements", [])
            for element in elements:
                raw_id = element.get("id")
                if raw_id is None:
                    continue
                versions.append({"id": int(raw_id), "name": element.get("name", str(raw_id))})

            count = int(response.get("count", len(elements)))
            total = int(response.get("total", len(elements)))
            if not elements or offset + count > total:
                break
            offset += count

        versions.sort(key=lambda item: item["id"], reverse=True)
        return versions[:limit]

    def fetch_all_statuses(self) -> list[str]:
        response = self.http.get_json("/api/v3/statuses")
        names = [
            str(element.get("name", "")).strip()
            for element in response.get("_embedded", {}).get("elements", [])
            if element.get("name")
        ]
        return [name for name in names if name]

    def fetch_allowed_status_transitions(self, work_package_id: int) -> list[str]:
        work_package = self.http.get_json(f"/api/v3/work_packages/{work_package_id}")
        allowed_values = self._allowed_status_values_from_form(
            int(work_package["id"]),
            int(work_package["lockVersion"]),
        )
        if not allowed_values:
            schema_href = work_package.get("_links", {}).get("schema", {}).get("href")
            if schema_href:
                schema = self.http.get_json(schema_href)
                allowed_values = (
                    schema.get("status", {})
                    .get("_embedded", {})
                    .get("allowedValues", [])
                )
        return [str(item.get("name", "")).strip() for item in allowed_values if item.get("name")]

    def fetch_story(self, work_package_id: int) -> Story:
        response = self.http.get_json(f"/api/v3/work_packages/{work_package_id}")
        return self._parse_story(response)

    def update_story_status(self, work_package_id: int, status_name: str) -> Story:
        return self._update_story_status_once(work_package_id, status_name, allow_retry=True)

    def _update_story_status_once(self, work_package_id: int, status_name: str, allow_retry: bool) -> Story:
        work_package = self.http.get_json(f"/api/v3/work_packages/{work_package_id}")
        current_status = (
            work_package.get("_embedded", {}).get("status", {}).get("name")
            or work_package.get("_links", {}).get("status", {}).get("title")
            or ""
        )
        if current_status.strip().casefold() == status_name.strip().casefold():
            return self._parse_story(work_package)

        try:
            status_href = self._resolve_allowed_status_href(work_package, status_name)
        except RuntimeError as exc:
            if allow_retry and "HTTP 409" in str(exc):
                return self._update_story_status_once(work_package_id, status_name, allow_retry=False)
            raise

        payload = {
            "lockVersion": int(work_package["lockVersion"]),
            "_links": {
                "status": {
                    "href": status_href,
                }
            },
        }
        try:
            response = self.http.patch_json(f"/api/v3/work_packages/{work_package_id}", payload=payload)
        except RuntimeError as exc:
            if allow_retry and "HTTP 409" in str(exc):
                return self._update_story_status_once(work_package_id, status_name, allow_retry=False)
            raise
        return self._parse_story(response)

    def fetch_story_comments(self, work_package_id: int) -> list[Comment]:
        comments: list[Comment] = []
        offset = 1

        while True:
            response = self.http.get_json(
                f"/api/v3/work_packages/{work_package_id}/activities",
                query={"pageSize": 200, "offset": offset},
            )
            elements = response.get("_embedded", {}).get("elements", [])
            for element in elements:
                comment = self._parse_comment(element)
                if comment and comment.comment:
                    comments.append(comment)

            count = int(response.get("count", len(elements)))
            total = int(response.get("total", len(elements)))
            if not elements or offset + count > total:
                break
            offset += count
        return comments

    def add_story_comment(self, work_package_id: int, comment: str) -> Comment:
        payload = {
            "comment": {
                "raw": comment,
                "format": "markdown",
            }
        }
        response = self.http.post_json(f"/api/v3/work_packages/{work_package_id}/activities", payload=payload)
        parsed = self._parse_comment(response)
        if not parsed:
            raise ValueError("OpenProject returned no comment payload.")
        return parsed

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
        description_html = None
        if isinstance(description, dict):
            description_html = description.get("html")
            description = description.get("raw") or description_html
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
            type_name=payload.get("_links", {}).get("type", {}).get("title"),
            status_name=(
                embedded.get("status", {}).get("name")
                or payload.get("_links", {}).get("status", {}).get("title")
                or "Unknown"
            ),
            priority_name=payload.get("_links", {}).get("priority", {}).get("title"),
            assignee_id=self._extract_user_id(payload.get("_links", {}).get("assignee", {}).get("href")),
            assignee_name=payload.get("_links", {}).get("assignee", {}).get("title"),
            responsible_name=payload.get("_links", {}).get("responsible", {}).get("title"),
            project_name=embedded.get("project", {}).get("name", "Unknown project"),
            version_name=embedded.get("version", {}).get("name", ""),
            description=description,
            description_html=description_html,
            permalink=permalink,
            ui_link=ui_link,
            due_date=payload.get("dueDate"),
            start_date=payload.get("startDate"),
            estimated_time=payload.get("estimatedTime"),
            tag_names=self._extract_tags(payload),
        )

    def _parse_comment(self, payload: dict[str, Any]) -> Comment | None:
        comment_payload = payload.get("comment")
        if isinstance(comment_payload, dict):
            text = comment_payload.get("raw") or comment_payload.get("html") or ""
        else:
            text = str(comment_payload or "")
        if not text and not payload.get("_links", {}).get("user", {}).get("title"):
            return None
        return Comment(
            id=int(payload["id"]) if str(payload.get("id", "")).isdigit() else None,
            author_name=payload.get("_links", {}).get("user", {}).get("title", "OpenProject"),
            created_at=payload.get("createdAt"),
            updated_at=payload.get("updatedAt"),
            comment=text,
        )

    def _extract_user_id(self, href: str | None) -> int | None:
        if not href:
            return None
        try:
            return int(str(href).rstrip("/").split("/")[-1])
        except (TypeError, ValueError):
            return None

    def _extract_tags(self, payload: dict[str, Any]) -> tuple[str, ...]:
        tags: list[str] = []
        category_title = payload.get("_links", {}).get("category", {}).get("title")
        if category_title:
            tags.append(str(category_title))
        return tuple(tags)

    def _resolve_allowed_status_href(self, work_package: dict[str, Any], status_name: str) -> str:
        allowed_values = self._allowed_status_values_from_form(
            int(work_package["id"]),
            int(work_package["lockVersion"]),
        )
        if not allowed_values:
            schema_href = work_package.get("_links", {}).get("schema", {}).get("href")
            if schema_href:
                schema = self.http.get_json(schema_href)
                allowed_values = (
                    schema.get("status", {})
                    .get("_embedded", {})
                    .get("allowedValues", [])
                )

        requested = status_name.strip().casefold()
        for item in allowed_values:
            if str(item.get("name", "")).strip().casefold() == requested:
                href = item.get("_links", {}).get("self", {}).get("href")
                if href:
                    return str(href)

        allowed_names = [str(item.get("name", "")).strip() for item in allowed_values if item.get("name")]
        raise ValueError(
            f"OpenProject status transition to '{status_name}' is not allowed. "
            f"Allowed: {', '.join(allowed_names) or 'none'}."
        )

    def _allowed_status_values_from_form(self, work_package_id: int, lock_version: int) -> list[dict[str, Any]]:
        form = self.http.post_json(
            f"/api/v3/work_packages/{work_package_id}/form",
            payload={"lockVersion": lock_version},
        )
        return (
            form.get("_embedded", {})
            .get("schema", {})
            .get("status", {})
            .get("_embedded", {})
            .get("allowedValues", [])
        )

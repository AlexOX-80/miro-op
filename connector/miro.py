from __future__ import annotations

from collections import defaultdict
from typing import Any

from .http import HttpClient
from .models import Story


class MiroClient:
    OPENPROJECT_ID_MARKER = "OpenProject ID:"
    FRAME_MARKER = "[OP-MIRO-FRAME]"
    HEADER_Y_OFFSET = -220
    FRAME_PADDING_X = 400
    FRAME_PADDING_TOP = 380
    FRAME_PADDING_BOTTOM = 220
    STATUS_MAP = {
        "neu": "to-do",
        "new": "to-do",
        "ready": "to-do",
        "abklären": "in-progress",
        "abklaeren": "in-progress",
        "priorisiert": "in-progress",
        "in progress": "in-progress",
        "in bearbeitung": "in-progress",
        "done": "done",
        "closed": "done",
        "erledigt": "done",
        "abgenommen": "done",
    }

    def __init__(self, base_url: str, access_token: str, board_id: str) -> None:
        self.board_id = board_id
        self._board_members_by_name: dict[str, str] | None = None
        self.http = HttpClient(
            base_url=base_url.rstrip("/"),
            default_headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )

    def create_cards(
        self,
        stories: list[Story],
        columns: dict[str, dict[str, int]],
        vertical_spacing: int,
        dry_run: bool = False,
        sync_existing: bool = True,
        frame_title: str | None = None,
        assignee_map: dict[str, str] | None = None,
    ) -> list[dict[str, str]]:
        created: list[dict[str, str]] = []
        next_row_by_status: dict[str, int] = defaultdict(int)
        existing_cards = (
            self._get_existing_cards_by_openproject_id() if sync_existing else {}
        )
        header_result = self.ensure_column_headers(columns=columns, dry_run=dry_run)
        frame_id = None
        frame_result: dict[str, Any] | None = None
        if frame_title:
            frame_result = self.ensure_version_frame(
                frame_title=frame_title,
                stories=stories,
                columns=columns,
                vertical_spacing=vertical_spacing,
                dry_run=dry_run,
            )
            frame_id = frame_result.get("frame_id")
            for title, item_id in header_result["header_ids"].items():
                column = columns[title]
                self._move_item_into_frame(
                    item_id=item_id,
                    frame_id=frame_id,
                    position={
                        "x": int(column["x"]),
                        "y": int(column["y"]) + self.HEADER_Y_OFFSET,
                    },
                    frame_geometry=frame_result["geometry"],
                    frame_position=frame_result["position"],
                    dry_run=dry_run,
                )

        for story in stories:
            column = columns.get(story.status_name)
            if not column:
                raise ValueError(
                    f"No Miro column configured for OpenProject status '{story.status_name}'."
                )

            row_index = next_row_by_status[story.status_name]
            next_row_by_status[story.status_name] += 1
            position = {
                "x": int(column["x"]),
                "y": int(column["y"]) + row_index * vertical_spacing,
            }

            payload = {
                "data": {
                    "title": story.subject,
                    "description": self._build_description(story),
                },
                "position": position,
                "style": {
                    "cardTheme": self._card_theme_for_priority(story.priority_name),
                },
            }
            if story.due_date:
                payload["dueDate"] = story.due_date
            if story.start_date:
                payload["startDate"] = story.start_date
            existing_card = existing_cards.get(story.id)
            existing_card_id = None if not existing_card else str(existing_card.get("id"))

            if dry_run:
                created.append(
                    {
                        "story": f"#{story.id} {story.subject}",
                        "status": story.status_name,
                        "position": f"({position['x']}, {position['y']})",
                        "card_id": existing_card_id or "dry-run",
                        "action": "update" if existing_card_id else "create",
                    }
                )
                continue

            if existing_card_id:
                update_payload = payload
                if existing_card.get("parent"):
                    update_payload = {
                        key: value for key, value in payload.items() if key != "position"
                    }
                response = self.http.patch_json(
                    f"/boards/{self.board_id}/cards/{existing_card_id}",
                    payload=update_payload,
                )
                if frame_id and frame_result:
                    self._move_item_into_frame(
                        item_id=existing_card_id,
                        frame_id=frame_id,
                        position=position,
                        frame_geometry=frame_result["geometry"],
                        frame_position=frame_result["position"],
                        dry_run=dry_run,
                    )
                action = "update"
            else:
                response = self.http.post_json(
                    f"/boards/{self.board_id}/cards",
                    payload=payload,
                )
                created_card_id = str(response.get("id", "unknown"))
                if frame_id and frame_result:
                    self._move_item_into_frame(
                        item_id=created_card_id,
                        frame_id=frame_id,
                        position=position,
                        frame_geometry=frame_result["geometry"],
                        frame_position=frame_result["position"],
                        dry_run=dry_run,
                    )
                action = "create"
            created.append(
                {
                    "story": f"#{story.id} {story.subject}",
                    "status": story.status_name,
                    "position": f"({position['x']}, {position['y']})",
                    "card_id": str(response.get("id", "unknown")),
                    "action": action,
                }
            )

        return created

    def ensure_version_frame(
        self,
        frame_title: str,
        stories: list[Story],
        columns: dict[str, dict[str, int]],
        vertical_spacing: int,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        existing_frame = None if dry_run else self._get_existing_frame(frame_title)
        existing_id = None if not existing_frame else str(existing_frame.get("id"))
        x_values = [int(column["x"]) for column in columns.values()]
        y_values = [int(column["y"]) for column in columns.values()]
        min_x = min(x_values)
        max_x = max(x_values)
        base_y = min(y_values)
        tallest_column_size = 0
        stories_by_status: dict[str, int] = defaultdict(int)
        for story in stories:
            stories_by_status[story.status_name] += 1
        if stories_by_status:
            tallest_column_size = max(stories_by_status.values())

        width = (max_x - min_x) + (self.FRAME_PADDING_X * 2) + 600
        height = (
            self.FRAME_PADDING_TOP
            + self.FRAME_PADDING_BOTTOM
            + max(500, max(0, tallest_column_size - 1) * vertical_spacing + 520)
        )
        center_x = (min_x + max_x) / 2
        center_y = base_y + (height / 2) + self.HEADER_Y_OFFSET
        payload = {
            "data": {
                "title": self._build_frame_title(frame_title),
            },
            "position": {"x": center_x, "y": center_y},
            "geometry": {"width": width, "height": height},
        }

        if dry_run:
            return {
                "title": frame_title,
                "action": "update" if existing_id else "create",
                "frame_id": existing_id or "dry-run",
                "position": {"x": center_x, "y": center_y},
                "geometry": {"width": width, "height": height},
            }

        if existing_id and self._frame_is_transparent(existing_frame):
            self.http.patch_json(f"/boards/{self.board_id}/frames/{existing_id}", payload)
            return {
                "title": frame_title,
                "action": "update",
                "frame_id": existing_id,
                "position": {"x": center_x, "y": center_y},
                "geometry": {"width": width, "height": height},
            }

        if existing_id:
            self.http.delete(f"/boards/{self.board_id}/frames/{existing_id}")

        response = self.http.post_json(f"/boards/{self.board_id}/frames", payload)
        return {
            "title": frame_title,
            "action": "recreate" if existing_id else "create",
            "frame_id": str(response.get("id", "")),
            "position": {"x": center_x, "y": center_y},
            "geometry": {"width": width, "height": height},
        }

    def _get_existing_cards_by_openproject_id(self) -> dict[int, dict[str, Any]]:
        cards_by_story_id: dict[int, dict[str, Any]] = {}
        items = self.http.iter_collection(
            f"/boards/{self.board_id}/items",
            query={"type": "card", "limit": 50},
        )
        for item in items:
            story_id = self._extract_story_id(item)
            if story_id is not None:
                cards_by_story_id[story_id] = item

        return cards_by_story_id

    def ensure_column_headers(
        self,
        columns: dict[str, dict[str, int]],
        dry_run: bool = False,
    ) -> dict[str, Any]:
        existing_headers = {} if dry_run else self._get_existing_headers()
        results: list[dict[str, str]] = []
        header_ids: dict[str, str] = {}

        for title, column in columns.items():
            payload = {
                "data": {"content": self._build_header_content(title)},
                "position": {"x": int(column["x"]), "y": int(column["y"]) + self.HEADER_Y_OFFSET},
                "geometry": {"width": 360},
                "style": {
                    "fillColor": "#ffffff",
                    "textAlign": "center",
                    "fontSize": 28,
                    "color": "#1a1a1a",
                },
            }
            existing_header = existing_headers.get(title)
            existing_id = None if not existing_header else str(existing_header.get("id"))

            if dry_run:
                results.append({"title": title, "action": "update" if existing_id else "create"})
                header_ids[title] = existing_id or f"dry-run-{title}"
                continue

            if existing_id:
                update_payload = payload
                if existing_header.get("parent"):
                    update_payload = {
                        key: value for key, value in payload.items() if key != "position"
                    }
                response = self.http.patch_json(
                    f"/boards/{self.board_id}/texts/{existing_id}",
                    update_payload,
                )
                header_ids[title] = str(response.get("id", existing_id))
                results.append({"title": title, "action": "update"})
            else:
                response = self.http.post_json(f"/boards/{self.board_id}/texts", payload)
                header_ids[title] = str(response.get("id", ""))
                results.append({"title": title, "action": "create"})

        return {"items": results, "header_ids": header_ids}

    def _get_existing_headers(self) -> dict[str, dict[str, Any]]:
        headers: dict[str, dict[str, Any]] = {}
        items = self.http.iter_collection(
            f"/boards/{self.board_id}/items",
            query={"type": "text", "limit": 50},
        )
        for item in items:
            content = item.get("data", {}).get("content", "")
            title = self._extract_header_title(content)
            if title:
                headers[title] = item
        return headers

    def _get_existing_frame(self, frame_title: str) -> dict[str, Any] | None:
        items = self.http.iter_collection(
            f"/boards/{self.board_id}/items",
            query={"type": "frame", "limit": 50},
        )
        expected_title = self._build_frame_title(frame_title)
        for item in items:
            title = item.get("data", {}).get("title")
            if title == expected_title:
                return item
        return None

    def _frame_is_transparent(self, frame: dict[str, Any] | None) -> bool:
        if not frame:
            return False
        style = frame.get("style", {})
        fill_color = style.get("fillColor")
        return not fill_color or fill_color == "transparent"

    def _build_header_content(self, title: str) -> str:
        return f"<p><strong>[OP-MIRO-COLUMN]</strong> {title}</p>"

    def _build_frame_title(self, title: str) -> str:
        return f"{self.FRAME_MARKER} {title}"

    def _resolve_assignee_id(self, story: Story, assignee_map: dict[str, str]) -> str | None:
        candidates: list[str] = []
        if story.assignee_id is not None:
            candidates.append(str(story.assignee_id))
        if story.assignee_name:
            candidates.append(story.assignee_name)

        for candidate in candidates:
            mapped = assignee_map.get(candidate)
            if mapped:
                return mapped

        if story.assignee_name:
            return self._get_board_members_by_name().get(story.assignee_name.casefold())
        return None

    def _get_board_members_by_name(self) -> dict[str, str]:
        if self._board_members_by_name is not None:
            return self._board_members_by_name

        response = self.http.get_json(f"/boards/{self.board_id}/members")
        members: dict[str, str] = {}
        for item in response.get("data", []):
            name = item.get("name")
            member_id = item.get("id")
            if name and member_id:
                members[str(name).casefold()] = str(member_id)
        self._board_members_by_name = members
        return members

    def _map_task_status(self, status_name: str) -> str:
        return self.STATUS_MAP.get(status_name.strip().lower(), "none")

    def _card_theme_for_priority(self, priority_name: str | None) -> str:
        if not priority_name:
            return "#2d9bf0"
        normalized = priority_name.strip().lower()
        if normalized in {"immediate", "sofort", "high", "hoch", "urgent", "dringend"}:
            return "#f24726"
        if normalized in {"normal", "medium", "mittel"}:
            return "#fac710"
        if normalized in {"low", "niedrig"}:
            return "#2d9bf0"
        return "#652cb3"

    def _field_fill_for_priority(self, priority_name: str) -> str:
        normalized = priority_name.strip().lower()
        if normalized in {"immediate", "sofort", "high", "hoch", "urgent", "dringend"}:
            return "#ffd6d6"
        if normalized in {"normal", "medium", "mittel"}:
            return "#fff1bf"
        if normalized in {"low", "niedrig"}:
            return "#d0ebff"
        return "#e5dbff"

    def _move_item_into_frame(
        self,
        item_id: str,
        frame_id: str,
        position: dict[str, int],
        frame_geometry: dict[str, float],
        frame_position: dict[str, float],
        dry_run: bool = False,
    ) -> None:
        if dry_run:
            return

        frame_top_left_x = float(frame_position["x"]) - (float(frame_geometry["width"]) / 2)
        frame_top_left_y = float(frame_position["y"]) - (float(frame_geometry["height"]) / 2)
        relative_x = float(position["x"]) - frame_top_left_x
        relative_y = float(position["y"]) - frame_top_left_y

        self.http.patch_json(
            f"/boards/{self.board_id}/items/{item_id}",
            payload={
                "parent": {"id": frame_id},
                "position": {
                    "x": relative_x,
                    "y": relative_y,
                    "relativeTo": "parent_top_left",
                },
            },
        )

    def _extract_header_title(self, content: str) -> str | None:
        marker = "[OP-MIRO-COLUMN]"
        if marker not in content:
            return None
        _, _, title = content.partition(marker)
        cleaned = (
            title.replace("</p>", "")
            .replace("<p>", "")
            .replace("<strong>", "")
            .replace("</strong>", "")
            .strip()
        )
        return cleaned or None

    def _extract_story_id(self, item: dict[str, Any]) -> int | None:
        description = item.get("data", {}).get("description", "")
        if not isinstance(description, str):
            return None

        for line in description.splitlines():
            if line.startswith(self.OPENPROJECT_ID_MARKER):
                _, _, raw_value = line.partition(":")
                raw_value = raw_value.strip()
                if raw_value.isdigit():
                    return int(raw_value)
        return None

    def _build_description(self, story: Story) -> str:
        lines = [
            f"{self.OPENPROJECT_ID_MARKER} {story.id}",
            f"Projekt: {story.project_name}",
            f"Version: {story.version_name}",
            f"Status: {story.status_name}",
        ]
        if story.priority_name:
            lines.append(f"Prioritaet: {story.priority_name}")
        if story.assignee_name:
            lines.append(f"Zugewiesen: {story.assignee_name}")
        if story.start_date:
            lines.append(f"Start: {story.start_date}")
        if story.due_date:
            lines.append(f"Faellig: {story.due_date}")
        if story.permalink:
            lines.append(f"Link: {story.permalink}")
        if story.ui_link:
            lines.append(f"Story: {story.ui_link}")
        if story.description:
            lines.append("")
            lines.append(story.description.strip())
        return "\n".join(lines)

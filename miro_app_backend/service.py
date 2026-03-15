from __future__ import annotations

from dataclasses import asdict
from typing import Any
from urllib import parse

from connector.http import HttpClient
from connector.models import Comment, Story
from connector.openproject import OpenProjectClient

from .settings import AppBackendSettings
from .store import LinkStore, TokenStore


class MiroAppCardService:
    OPENPROJECT_ID_MARKER = "OpenProject ID:"

    def __init__(
        self,
        settings: AppBackendSettings,
        store: LinkStore,
        token_store: TokenStore,
        access_token_override: str | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.token_store = token_store
        self.openproject = OpenProjectClient(
            base_url=settings.openproject_base_url,
            api_token=settings.openproject_api_token,
            auth_mode=settings.openproject_auth_mode,
        )
        access_token = access_token_override or self.token_store.get_token() or settings.miro_access_token
        self.miro = HttpClient(
            base_url=settings.miro_base_url,
            default_headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )

    def _board_id(self, board_id: str | None = None) -> str:
        return (board_id or self.settings.miro_board_id).strip()

    def list_stories(self) -> list[dict[str, Any]]:
        return self.list_stories_for_version(self.settings.openproject_version_name)

    def list_stories_for_version(self, version_name: str) -> list[dict[str, Any]]:
        stories = self.openproject.fetch_stories_for_version(
            version_name=version_name,
            story_type=self.settings.openproject_story_type,
        )
        return [self._story_to_public_dict(story) for story in stories]

    def list_recent_versions(self, limit: int = 5) -> list[dict[str, Any]]:
        return self.openproject.fetch_recent_versions(limit=limit)

    def list_all_statuses(self) -> list[str]:
        return self.openproject.fetch_all_statuses()

    def list_allowed_status_transitions(self, work_package_id: int) -> list[str]:
        return self.openproject.fetch_allowed_status_transitions(work_package_id)

    def get_story(self, work_package_id: int) -> Story:
        return self.openproject.fetch_story(work_package_id)

    def list_story_comments(self, work_package_id: int) -> list[Comment]:
        return self.openproject.fetch_story_comments(work_package_id)

    def add_story_comment(self, work_package_id: int, comment: str) -> Comment:
        return self.openproject.add_story_comment(work_package_id, comment)

    def connect_app_card(self, app_card_id: str, work_package_id: int, board_id: str | None = None) -> dict[str, Any]:
        story = self.get_story(work_package_id)
        payload = self._app_card_payload(story)
        resolved_board_id = self._board_id(board_id)
        response = self.miro.patch_json(
            f"/boards/{resolved_board_id}/app_cards/{app_card_id}",
            payload=payload,
        )
        link = self.store.save_link(
            app_card_id=app_card_id,
            work_package_id=work_package_id,
            board_id=resolved_board_id,
        )
        return {
            "appCard": response,
            "link": asdict(link),
            "story": self._story_to_public_dict(story),
        }

    def create_connected_app_card(
        self,
        work_package_id: int,
        x: float,
        y: float,
        width: float,
        board_id: str | None = None,
    ) -> dict[str, Any]:
        story = self.get_story(work_package_id)
        resolved_board_id = self._board_id(board_id)
        payload = {
            "data": self._app_card_payload(story)["data"],
            "position": {"x": x, "y": y},
            "geometry": {"width": width},
        }
        response = self.miro.post_json(
            f"/boards/{resolved_board_id}/app_cards",
            payload=payload,
        )
        link = self.store.save_link(
            app_card_id=str(response.get("id", "")),
            work_package_id=work_package_id,
            board_id=resolved_board_id,
        )
        return {
            "appCard": response,
            "link": asdict(link),
            "story": self._story_to_public_dict(story),
        }

    def refresh_app_card(
        self,
        app_card_id: str,
        fallback_work_package_id: int | None = None,
        board_id: str | None = None,
    ) -> dict[str, Any]:
        link = self._resolve_link(app_card_id, fallback_work_package_id, board_id)
        if not link:
            raise KeyError(f"No app card mapping found for {app_card_id}")
        story = self.get_story(link.work_package_id)
        response = self.miro.patch_json(
            f"/boards/{link.board_id}/app_cards/{app_card_id}",
            payload=self._app_card_payload(story),
        )
        self.store.save_link(
            app_card_id=app_card_id,
            work_package_id=link.work_package_id,
            board_id=link.board_id,
        )
        return {
            "appCard": response,
            "link": asdict(self.store.get_link(app_card_id)),
            "story": self._story_to_public_dict(story),
        }

    def get_connection(
        self,
        app_card_id: str,
        fallback_work_package_id: int | None = None,
        board_id: str | None = None,
    ) -> dict[str, Any] | None:
        link = self._resolve_link(app_card_id, fallback_work_package_id, board_id)
        if not link:
            return None
        story = self.get_story(link.work_package_id)
        return {
            "link": asdict(link),
            "story": self._story_to_public_dict(story),
            "comments": [self._comment_to_public_dict(item) for item in self.list_story_comments(link.work_package_id)],
            "allowedStatusTransitions": self.list_allowed_status_transitions(link.work_package_id),
        }

    def get_comments(
        self,
        app_card_id: str,
        fallback_work_package_id: int | None = None,
        board_id: str | None = None,
    ) -> dict[str, Any]:
        link = self._resolve_link(app_card_id, fallback_work_package_id, board_id)
        if not link:
            raise KeyError(f"No app card mapping found for {app_card_id}")
        return {
            "link": asdict(link),
            "items": [self._comment_to_public_dict(item) for item in self.list_story_comments(link.work_package_id)],
        }

    def create_comment(
        self,
        app_card_id: str,
        comment: str,
        fallback_work_package_id: int | None = None,
        board_id: str | None = None,
    ) -> dict[str, Any]:
        link = self._resolve_link(app_card_id, fallback_work_package_id, board_id)
        if not link:
            raise KeyError(f"No app card mapping found for {app_card_id}")
        created = self.add_story_comment(link.work_package_id, comment)
        return {
            "link": asdict(link),
            "item": self._comment_to_public_dict(created),
            "items": [self._comment_to_public_dict(item) for item in self.list_story_comments(link.work_package_id)],
        }

    def update_story_status_for_app_card(
        self,
        app_card_id: str,
        status_name: str,
        fallback_work_package_id: int | None = None,
        board_id: str | None = None,
    ) -> dict[str, Any]:
        link = self._resolve_link(app_card_id, fallback_work_package_id, board_id)
        if not link:
            raise KeyError(f"No app card mapping found for {app_card_id}")

        story = self.openproject.update_story_status(link.work_package_id, status_name)
        response = self.miro.patch_json(
            f"/boards/{link.board_id}/app_cards/{app_card_id}",
            payload=self._app_card_payload(story),
        )
        return {
            "appCard": response,
            "link": asdict(link),
            "story": self._story_to_public_dict(story),
        }

    def oauth_authorize_url(self) -> str:
        if not self.settings.miro_client_id:
            raise ValueError("MIRO_CLIENT_ID is not configured.")
        query = parse.urlencode(
            {
                "response_type": "code",
                "client_id": self.settings.miro_client_id,
                "redirect_uri": self.settings.miro_oauth_redirect_uri,
                "scope": "boards:read boards:write",
            }
        )
        return f"https://miro.com/oauth/authorize?{query}"

    def save_oauth_token(self, access_token: str) -> None:
        self.token_store.save_token(access_token)

    def oauth_status(self) -> dict[str, Any]:
        return {
            "hasStoredToken": self.token_store.has_token(),
            "hasFallbackToken": bool(self.settings.miro_access_token),
            "redirectUri": self.settings.miro_oauth_redirect_uri,
        }

    def has_valid_miro_token(self, board_id: str | None = None) -> bool:
        try:
            self.miro.get_json(f"/boards/{self._board_id(board_id)}")
            return True
        except RuntimeError:
            return False

    def _resolve_link(
        self,
        app_card_id: str,
        fallback_work_package_id: int | None = None,
        board_id: str | None = None,
    ):
        resolved_board_id = self._board_id(board_id)
        link = self.store.get_link(app_card_id)
        if link:
            return link

        if fallback_work_package_id is not None:
            return self.store.save_link(
                app_card_id=app_card_id,
                work_package_id=fallback_work_package_id,
                board_id=resolved_board_id,
            )

        app_card = self.miro.get_json(f"/boards/{resolved_board_id}/app_cards/{app_card_id}")
        work_package_id = self._extract_story_id(app_card)
        if work_package_id is None:
            return None
        return self.store.save_link(
            app_card_id=app_card_id,
            work_package_id=work_package_id,
            board_id=resolved_board_id,
        )

    def _app_card_payload(self, story: Story) -> dict[str, Any]:
        return {
            "data": {
                "title": story.subject,
                "description": self._build_description(story),
                "fields": self._build_fields(story),
            }
        }

    def _build_fields(self, story: Story) -> list[dict[str, str]]:
        fields: list[dict[str, str]] = []
        fields.append(
            {
                "value": f"Status: {story.status_name}",
                "fillColor": self._status_color(story.status_name),
                "textColor": "#1a1a1a",
                "tooltip": "OpenProject Status",
            }
        )
        if story.priority_name:
            fields.append(
                {
                    "value": f"Prio: {story.priority_name}",
                    "fillColor": self._priority_color(story.priority_name),
                    "textColor": "#1a1a1a",
                    "tooltip": "OpenProject Prioritaet",
                }
            )
        if story.assignee_name:
            fields.append(
                {
                    "value": f"Bearbeiter: {story.assignee_name}",
                    "fillColor": "#e6fcf5",
                    "textColor": "#1a1a1a",
                    "tooltip": "OpenProject Bearbeiter",
                }
            )
        if story.project_name and story.project_name != "Unknown project":
            fields.append(
                {
                    "value": story.project_name,
                    "fillColor": "#e7f5ff",
                    "textColor": "#1a1a1a",
                    "tooltip": "OpenProject Projekt",
                }
            )
        return fields

    def _build_description(self, story: Story) -> str:
        lines = [
            f"{self.OPENPROJECT_ID_MARKER} {story.id}",
            f"Version: {story.version_name}",
            f"Story: {story.ui_link or ''}".strip(),
        ]
        if story.description:
            lines.extend(["", story.description.strip()])
        return "\n".join(line for line in lines if line)

    def _extract_story_id(self, app_card: dict[str, Any]) -> int | None:
        description = app_card.get("data", {}).get("description", "")
        if not isinstance(description, str):
            return None
        for line in description.splitlines():
            if line.startswith(self.OPENPROJECT_ID_MARKER):
                _, _, raw_value = line.partition(":")
                raw_value = raw_value.strip()
                if raw_value.isdigit():
                    return int(raw_value)
        return None

    def _story_to_public_dict(self, story: Story) -> dict[str, Any]:
        return {
            "id": story.id,
            "subject": story.subject,
            "typeName": story.type_name,
            "statusName": story.status_name,
            "priorityName": story.priority_name,
            "assigneeName": story.assignee_name,
            "responsibleName": story.responsible_name,
            "projectName": story.project_name,
            "versionName": story.version_name,
            "description": story.description,
            "descriptionHtml": story.description_html,
            "uiLink": story.ui_link,
            "dueDate": story.due_date,
            "startDate": story.start_date,
            "estimatedTime": story.estimated_time,
            "tagNames": list(story.tag_names),
        }

    def _comment_to_public_dict(self, comment: Comment) -> dict[str, Any]:
        return {
            "id": comment.id,
            "authorName": comment.author_name,
            "createdAt": comment.created_at,
            "updatedAt": comment.updated_at,
            "comment": comment.comment,
        }

    def _priority_color(self, priority_name: str) -> str:
        normalized = priority_name.strip().lower()
        if normalized in {"hoch", "high", "urgent", "dringend", "immediate", "sofort"}:
            return "#ffd6d6"
        if normalized in {"normal", "medium", "mittel"}:
            return "#fff1bf"
        if normalized in {"low", "niedrig"}:
            return "#d0ebff"
        return "#e5dbff"

    def _status_color(self, status_name: str) -> str:
        normalized = status_name.strip().lower()
        if normalized in {"neu", "new", "ready"}:
            return "#d0ebff"
        if normalized in {"priorisiert", "abklären", "abklaeren", "in progress"}:
            return "#fff3bf"
        if normalized in {"done", "closed", "erledigt", "abgenommen"}:
            return "#d3f9d8"
        return "#f1f3f5"

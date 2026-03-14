from __future__ import annotations

from dataclasses import asdict
from typing import Any

from connector.http import HttpClient
from connector.models import Story
from connector.openproject import OpenProjectClient

from .settings import AppBackendSettings
from .store import AppCardLink, LinkStore


class MiroAppCardService:
    def __init__(self, settings: AppBackendSettings, store: LinkStore) -> None:
        self.settings = settings
        self.store = store
        self.openproject = OpenProjectClient(
            base_url=settings.openproject_base_url,
            api_token=settings.openproject_api_token,
            auth_mode=settings.openproject_auth_mode,
        )
        self.miro = HttpClient(
            base_url=settings.miro_base_url,
            default_headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {settings.miro_access_token}",
            },
        )

    def list_stories(self) -> list[dict[str, Any]]:
        stories = self.openproject.fetch_stories_for_version(
            version_name=self.settings.openproject_version_name,
            story_type=self.settings.openproject_story_type,
        )
        return [self._story_to_public_dict(story) for story in stories]

    def get_story(self, work_package_id: int) -> Story:
        return self.openproject.fetch_story(work_package_id)

    def connect_app_card(self, app_card_id: str, work_package_id: int) -> dict[str, Any]:
        story = self.get_story(work_package_id)
        payload = self._app_card_payload(story)
        response = self.miro.patch_json(
            f"/boards/{self.settings.miro_board_id}/app_cards/{app_card_id}",
            payload=payload,
        )
        link = self.store.save_link(
            app_card_id=app_card_id,
            work_package_id=work_package_id,
            board_id=self.settings.miro_board_id,
        )
        return {
            "appCard": response,
            "link": asdict(link),
            "story": self._story_to_public_dict(story),
        }

    def refresh_app_card(self, app_card_id: str) -> dict[str, Any]:
        link = self.store.get_link(app_card_id)
        if not link:
            raise KeyError(f"No app card mapping found for {app_card_id}")
        story = self.get_story(link.work_package_id)
        response = self.miro.patch_json(
            f"/boards/{self.settings.miro_board_id}/app_cards/{app_card_id}",
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

    def get_connection(self, app_card_id: str) -> dict[str, Any] | None:
        link = self.store.get_link(app_card_id)
        if not link:
            return None
        story = self.get_story(link.work_package_id)
        return {
            "link": asdict(link),
            "story": self._story_to_public_dict(story),
        }

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
            f"OpenProject ID: {story.id}",
            f"Version: {story.version_name}",
            f"Story: {story.ui_link or ''}".strip(),
        ]
        if story.description:
            lines.extend(["", story.description.strip()])
        return "\n".join(line for line in lines if line)

    def _story_to_public_dict(self, story: Story) -> dict[str, Any]:
        return {
            "id": story.id,
            "subject": story.subject,
            "statusName": story.status_name,
            "priorityName": story.priority_name,
            "assigneeName": story.assignee_name,
            "projectName": story.project_name,
            "versionName": story.version_name,
            "description": story.description,
            "uiLink": story.ui_link,
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

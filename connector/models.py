from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Story:
    id: int
    subject: str
    status_name: str
    priority_name: str | None
    assignee_id: int | None
    assignee_name: str | None
    project_name: str
    version_name: str
    description: str | None
    permalink: str | None
    ui_link: str | None
    due_date: str | None
    start_date: str | None

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Story:
    id: int
    subject: str
    type_name: str | None = None
    status_name: str = "Unknown"
    priority_name: str | None = None
    assignee_id: int | None = None
    assignee_name: str | None = None
    responsible_name: str | None = None
    project_name: str = "Unknown project"
    version_name: str = ""
    description: str | None = None
    description_html: str | None = None
    permalink: str | None = None
    ui_link: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    estimated_time: str | None = None
    tag_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class Comment:
    id: int | None
    author_name: str
    created_at: str | None
    updated_at: str | None
    comment: str

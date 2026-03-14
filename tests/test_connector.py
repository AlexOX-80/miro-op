import unittest

from connector.miro import MiroClient
from connector.models import Story
from connector.openproject import OpenProjectClient
from miro_app_backend.store import LinkStore


class LinkStoreTests(unittest.TestCase):
    def test_link_store_roundtrip(self) -> None:
        from tempfile import TemporaryDirectory
        from pathlib import Path

        with TemporaryDirectory() as tmp:
            store = LinkStore(Path(tmp) / "links.json")
            saved = store.save_link("abc", 42, "board-1")
            loaded = store.get_link("abc")

            self.assertEqual(saved.app_card_id, "abc")
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.work_package_id, 42)
            self.assertEqual(loaded.board_id, "board-1")


class ConnectorTests(unittest.TestCase):
    def test_openproject_uses_basic_auth_for_api_tokens(self) -> None:
        client = OpenProjectClient("https://openproject.example.com", "token", auth_mode="basic")
        self.assertTrue(client.http.default_headers["Authorization"].startswith("Basic "))

    def test_openproject_story_parsing_builds_absolute_permalink(self) -> None:
        client = OpenProjectClient("https://openproject.example.com", "token")

        story = client._parse_story(
            {
                "id": 42,
                "subject": "Story title",
                "description": {"raw": "Details"},
                "_embedded": {
                    "status": {"name": "New"},
                    "project": {"name": "Shop"},
                    "version": {"name": "Release 1.0"},
                },
                "_links": {
                    "self": {"href": "/api/v3/work_packages/42"},
                },
            }
        )

        self.assertEqual(story.project_name, "Shop")
        self.assertEqual(story.status_name, "New")
        self.assertEqual(story.version_name, "Release 1.0")
        self.assertIsNone(story.priority_name)
        self.assertIsNone(story.assignee_id)
        self.assertIsNone(story.assignee_name)
        self.assertEqual(
            story.permalink,
            "https://openproject.example.com/api/v3/work_packages/42",
        )
        self.assertEqual(
            story.ui_link,
            "https://openproject.example.com/work_packages/42",
        )
        self.assertIsNone(story.due_date)

    def test_openproject_story_parsing_uses_link_status_title_as_fallback(self) -> None:
        client = OpenProjectClient("https://openproject.example.com", "token")

        story = client._parse_story(
            {
                "id": 43,
                "subject": "Story title",
                "_embedded": {
                    "project": {"name": "Shop"},
                    "version": {"name": "Release 1.0"},
                },
                "_links": {
                    "self": {"href": "/api/v3/work_packages/43"},
                    "status": {"href": "/api/v3/statuses/1", "title": "Neu"},
                    "assignee": {"href": "/api/v3/users/49", "title": "Alexander Ochs"},
                },
            }
        )

        self.assertEqual(story.status_name, "Neu")
        self.assertEqual(story.assignee_id, 49)
        self.assertEqual(story.assignee_name, "Alexander Ochs")
        self.assertEqual(
            story.ui_link,
            "https://openproject.example.com/work_packages/43",
        )

    def test_miro_create_cards_assigns_rows_per_status(self) -> None:
        client = MiroClient("https://api.miro.com/v2", "token", "board")
        stories = [
            Story(
                id=1,
                subject="A",
                status_name="New",
                priority_name="High",
                assignee_id=49,
                assignee_name="Alexander Ochs",
                project_name="P1",
                version_name="R1",
                description=None,
                permalink=None,
                ui_link="https://openproject.example.com/work_packages/1",
                due_date="2026-03-31",
                start_date="2026-03-14",
            ),
            Story(
                id=2,
                subject="B",
                status_name="New",
                priority_name=None,
                assignee_id=None,
                assignee_name=None,
                project_name="P2",
                version_name="R1",
                description=None,
                permalink=None,
                ui_link="https://openproject.example.com/work_packages/2",
                due_date=None,
                start_date=None,
            ),
        ]

        created = client.create_cards(
            stories=stories,
            columns={"New": {"x": 100, "y": 200}},
            vertical_spacing=50,
            dry_run=True,
            sync_existing=False,
            assignee_map={"49": "3458764557509843558"},
        )

        self.assertEqual(created[0]["position"], "(100, 200)")
        self.assertEqual(created[1]["position"], "(100, 250)")
        self.assertEqual(created[0]["action"], "create")

    def test_miro_builds_header_marker_content(self) -> None:
        client = MiroClient("https://api.miro.com/v2", "token", "board")
        content = client._build_header_content("Neu")
        self.assertIn("[OP-MIRO-COLUMN]", content)
        self.assertEqual(client._extract_header_title(content), "Neu")

    def test_miro_builds_frame_marker_title(self) -> None:
        client = MiroClient("https://api.miro.com/v2", "token", "board")
        self.assertEqual(
            client._build_frame_title("Sprint KW 12/13 26"),
            "[OP-MIRO-FRAME] Sprint KW 12/13 26",
        )

    def test_miro_maps_status_and_priority(self) -> None:
        client = MiroClient("https://api.miro.com/v2", "token", "board")
        self.assertEqual(client._map_task_status("Neu"), "to-do")
        self.assertEqual(client._map_task_status("priorisiert"), "in-progress")
        self.assertEqual(client._map_task_status("Erledigt"), "done")
        self.assertEqual(client._card_theme_for_priority("High"), "#f24726")

    def test_miro_resolves_assignee_from_mapping(self) -> None:
        client = MiroClient("https://api.miro.com/v2", "token", "board")
        story = Story(
            id=1,
            subject="A",
            status_name="New",
            priority_name=None,
            assignee_id=496,
            assignee_name="David Knaeple",
            project_name="P1",
            version_name="R1",
            description=None,
            permalink=None,
            ui_link=None,
            due_date=None,
            start_date=None,
        )
        self.assertEqual(
            client._resolve_assignee_id(story, {"496": "3458764557509843558"}),
            "3458764557509843558",
        )

    def test_miro_extracts_existing_story_mapping_from_card_description(self) -> None:
        client = MiroClient("https://api.miro.com/v2", "token", "board")

        story_id = client._extract_story_id(
            {
                "id": "345",
                "data": {
                    "description": "OpenProject ID: 42\nProjekt: Shop\nStatus: New",
                },
            }
        )

        self.assertEqual(story_id, 42)

    def test_openproject_fetch_stories_handles_pagination(self) -> None:
        client = OpenProjectClient("https://openproject.example.com", "token")

        class DummyHttp:
            def __init__(self) -> None:
                self.calls = []

            def get_json(self, path, query=None):
                if path == "/api/v3/types":
                    return {
                        "_embedded": {
                            "elements": [
                                {"id": 6, "name": "User story"},
                            ]
                        }
                    }
                if path == "/api/v3/versions":
                    return {
                        "count": 1,
                        "total": 1,
                        "_embedded": {
                            "elements": [
                                {"id": 1649, "name": "R1"},
                            ]
                        },
                    }

                self.calls.append(query["offset"])
                if query["offset"] == 1:
                    return {
                        "count": 1,
                        "total": 2,
                        "_embedded": {
                            "elements": [
                                {
                                    "id": 1,
                                    "subject": "One",
                                    "_embedded": {
                                        "status": {"name": "New"},
                                        "project": {"name": "P1"},
                                        "version": {"name": "R1"},
                                    },
                                    "_links": {"self": {"href": "/api/v3/work_packages/1"}},
                                }
                            ]
                        },
                    }
                return {
                    "count": 1,
                    "total": 2,
                    "_embedded": {
                        "elements": [
                            {
                                "id": 2,
                                "subject": "Two",
                                "_embedded": {
                                    "status": {"name": "New"},
                                    "project": {"name": "P2"},
                                    "version": {"name": "R1"},
                                },
                                "_links": {"self": {"href": "/api/v3/work_packages/2"}},
                            }
                        ]
                    },
                }

        dummy_http = DummyHttp()
        client.http = dummy_http
        stories = client.fetch_stories_for_version("R1", "User story")

        self.assertEqual(dummy_http.calls, [1, 2])
        self.assertEqual([story.id for story in stories], [1, 2])

    def test_openproject_resolves_type_and_version_ids_by_name(self) -> None:
        client = OpenProjectClient("https://openproject.example.com", "token")

        class DummyHttp:
            def get_json(self, path, query=None):
                if path == "/api/v3/types":
                    return {"_embedded": {"elements": [{"id": 6, "name": "User story"}]}}
                if path == "/api/v3/versions":
                    return {
                        "count": 1,
                        "total": 1,
                        "_embedded": {"elements": [{"id": 1649, "name": "Sprint KW 12/13 26"}]},
                    }
                raise AssertionError(f"Unexpected path {path}")

        client.http = DummyHttp()

        self.assertEqual(client._resolve_type_id("User story"), 6)
        self.assertEqual(client._resolve_version_id("Sprint KW 12/13 26"), 1649)

    def test_openproject_fetch_story_reads_single_work_package(self) -> None:
        client = OpenProjectClient("https://openproject.example.com", "token")

        class DummyHttp:
            def get_json(self, path, query=None):
                self.path = path
                return {
                    "id": 99,
                    "subject": "Single",
                    "_embedded": {
                        "status": {"name": "New"},
                        "project": {"name": "P"},
                        "version": {"name": "R"},
                    },
                    "_links": {"self": {"href": "/api/v3/work_packages/99"}},
                }

        dummy_http = DummyHttp()
        client.http = dummy_http

        story = client.fetch_story(99)
        self.assertEqual(dummy_http.path, "/api/v3/work_packages/99")
        self.assertEqual(story.id, 99)


if __name__ == "__main__":
    unittest.main()

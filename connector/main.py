from __future__ import annotations

import argparse
import sys

from .config import load_config
from .miro import MiroClient
from .openproject import OpenProjectClient


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export OpenProject user stories of a version to Miro cards."
    )
    parser.add_argument("--env-file", help="Path to .env file", default=".env")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read from OpenProject, but do not create cards in Miro.",
    )
    parser.add_argument(
        "--no-sync-existing",
        action="store_true",
        help="Always create new Miro cards instead of updating existing ones.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        config = load_config(args.env_file)
        openproject = OpenProjectClient(
            base_url=config.openproject_base_url,
            api_token=config.openproject_api_token,
            auth_mode=config.openproject_auth_mode,
        )
        miro = MiroClient(
            base_url=config.miro_base_url,
            access_token=config.miro_access_token,
            board_id=config.miro_board_id,
        )

        stories = openproject.fetch_stories_for_version(
            version_name=config.openproject_version_name,
            story_type=config.openproject_story_type,
        )
        print(
            f"Found {len(stories)} story/stories for version "
            f"'{config.openproject_version_name}'."
        )

        created = miro.create_cards(
            stories=stories,
            columns=config.miro_columns,
            vertical_spacing=config.miro_card_vertical_spacing,
            dry_run=args.dry_run,
            sync_existing=not args.no_sync_existing,
            frame_title=config.openproject_version_name,
            assignee_map=config.miro_assignee_map,
        )

        for item in created:
            print(
                f"[{item['status']}] {item['action']} {item['story']} -> {item['card_id']} "
                f"at {item['position']}"
            )
        return 0
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"Error: {exc}", file=sys.stderr)
        return 1

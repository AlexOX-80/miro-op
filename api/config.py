from __future__ import annotations

from ._lib import build_service, json_response


def app(environ, start_response):
    service = build_service()
    settings = service.settings
    return json_response(
        start_response,
        200,
        {
            "boardId": settings.miro_board_id,
            "versionName": settings.openproject_version_name,
            "appPublicUrl": settings.app_public_url,
        },
    )

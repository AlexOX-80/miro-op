from __future__ import annotations

from ._lib import build_service, json_response


def app(environ, start_response):
    service = build_service()
    settings = service.settings
    return json_response(
        start_response,
        200,
        {
            "appUrl": f"{settings.app_public_url}/",
            "connectModalUrl": f"{settings.app_public_url}/connect.html",
            "openModalUrl": f"{settings.app_public_url}/modal.html",
            "healthUrl": f"{settings.app_public_url}/api/health",
            "storiesApiUrl": f"{settings.app_public_url}/api/stories",
            "oauthStartUrl": f"{settings.app_public_url}/api/oauth/start",
            "oauthStatusUrl": f"{settings.app_public_url}/api/oauth/status",
            "oauthRedirectUri": settings.miro_oauth_redirect_uri,
            "boardId": settings.miro_board_id,
            "icons": [
                {
                    "label": "Kontursymbol",
                    "url": f"{settings.app_public_url}/icons/openproject-miro-outline.svg",
                },
                {
                    "label": "Farbsymbol",
                    "url": f"{settings.app_public_url}/icons/openproject-miro-color.svg",
                },
            ],
        },
    )

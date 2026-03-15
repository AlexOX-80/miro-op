from __future__ import annotations

from ._lib import build_service, get_cookie, json_response, query_param


def app(environ, start_response):
    service = build_service(environ=environ)
    settings = service.settings
    board_id = query_param(environ, "board_id")
    oauth_status = service.oauth_status()
    has_valid_token = service.has_valid_miro_token(board_id)
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
            "oauthStatusUrl": f"{settings.app_public_url}/api/setup",
            "oauthRedirectUri": settings.miro_oauth_redirect_uri,
            "hasStoredToken": oauth_status["hasStoredToken"],
            "hasFallbackToken": oauth_status["hasFallbackToken"],
            "redirectUri": oauth_status["redirectUri"],
            "hasHeaderToken": bool(environ.get("HTTP_X_MIRO_OAUTH_TOKEN")),
            "hasCookieToken": bool(get_cookie(environ, "miro_oauth_token")),
            "hasValidToken": has_valid_token,
            "hasUsableToken": has_valid_token,
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

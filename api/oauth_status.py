from __future__ import annotations

from ._lib import build_service, get_cookie, json_response, query_param


def app(environ, start_response):
    service = build_service(environ=environ)
    board_id = query_param(environ, "board_id")
    payload = service.oauth_status()
    payload["hasHeaderToken"] = bool(environ.get("HTTP_X_MIRO_OAUTH_TOKEN"))
    payload["hasCookieToken"] = bool(get_cookie(environ, "miro_oauth_token"))
    payload["hasValidToken"] = service.has_valid_miro_token(board_id)
    payload["hasUsableToken"] = payload["hasValidToken"]
    return json_response(start_response, 200, payload)

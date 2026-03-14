from __future__ import annotations

from ._lib import build_service, json_response, query_param


def app(environ, start_response):
    service = build_service()
    try:
        authorize_url = service.oauth_authorize_url()
    except ValueError as exc:
        return json_response(start_response, 400, {"error": str(exc)})
    if query_param(environ, "format") != "json":
        start_response(
            "302 FOUND",
            [
                ("Location", authorize_url),
                ("Cache-Control", "no-store"),
            ],
        )
        return [b""]
    return json_response(
        start_response,
        200,
        {
            "authorizeUrl": authorize_url,
            "redirectUri": service.settings.miro_oauth_redirect_uri,
            "status": service.oauth_status(),
        },
    )

from __future__ import annotations

from ._lib import build_service, json_response, query_param


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") != "PATCH":
        return json_response(start_response, 405, {"error": "method_not_allowed"})
    app_card_id = query_param(environ, "app_card_id")
    if not app_card_id:
        return json_response(start_response, 400, {"error": "missing_app_card_id"})
    service = build_service()
    try:
        result = service.refresh_app_card(app_card_id)
    except KeyError:
        return json_response(start_response, 404, {"error": "not_found"})
    return json_response(start_response, 200, result)

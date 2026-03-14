from __future__ import annotations

from ._lib import build_service, json_response, query_param


def app(environ, start_response):
    app_card_id = query_param(environ, "app_card_id")
    if not app_card_id:
        return json_response(start_response, 400, {"error": "missing_app_card_id"})
    service = build_service()
    result = service.get_connection(app_card_id)
    if result is None:
        return json_response(start_response, 404, {"error": "not_found"})
    return json_response(start_response, 200, result)

from __future__ import annotations

from ._lib import build_service, json_response, parse_json_body


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") != "POST":
        return json_response(start_response, 405, {"error": "method_not_allowed"})
    service = build_service()
    payload = parse_json_body(environ)
    result = service.connect_app_card(
        app_card_id=str(payload["appCardId"]),
        work_package_id=int(payload["workPackageId"]),
    )
    return json_response(start_response, 200, result)

from __future__ import annotations

import traceback

from ._lib import build_service, json_response, parse_json_body


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") != "POST":
        return json_response(start_response, 405, {"error": "method_not_allowed"})
    service = build_service(environ=environ)
    payload = parse_json_body(environ)
    try:
        work_package_id = int(payload["workPackageId"])
        app_card_id = payload.get("appCardId")
        board_id = str(payload.get("boardId", "")).strip() or None
        if app_card_id:
            result = service.connect_app_card(
                app_card_id=str(app_card_id),
                work_package_id=work_package_id,
                board_id=board_id,
            )
        else:
            result = service.create_connected_app_card(
                work_package_id=work_package_id,
                x=float(payload["x"]),
                y=float(payload["y"]),
                width=float(payload.get("width", 320)),
                board_id=board_id,
            )
        return json_response(start_response, 200, result)
    except Exception as exc:
        return json_response(
            start_response,
            500,
            {
                "error": str(exc),
                "type": exc.__class__.__name__,
                "trace": traceback.format_exc().splitlines()[-5:],
            },
        )

from __future__ import annotations

import traceback

from ._lib import build_service, json_response, parse_json_body, query_param


def _fallback_work_package_id(environ) -> int | None:
    raw = query_param(environ, "work_package_id")
    return int(raw) if raw and raw.isdigit() else None


def app(environ, start_response):
    app_card_id = query_param(environ, "app_card_id")
    if not app_card_id:
        return json_response(start_response, 400, {"error": "missing_app_card_id"})

    service = build_service(environ=environ)
    fallback_work_package_id = _fallback_work_package_id(environ)
    board_id = query_param(environ, "board_id")
    method = environ.get("REQUEST_METHOD", "GET").upper()

    try:
        if method == "GET":
            return json_response(
                start_response,
                200,
                service.get_comments(app_card_id, fallback_work_package_id, board_id),
            )
        if method == "POST":
            payload = parse_json_body(environ)
            comment = str(payload.get("comment", "")).strip()
            if not comment:
                return json_response(start_response, 400, {"error": "missing_comment"})
            return json_response(
                start_response,
                200,
                service.create_comment(app_card_id, comment, fallback_work_package_id, board_id),
            )
        return json_response(start_response, 405, {"error": "method_not_allowed"})
    except KeyError:
        return json_response(start_response, 404, {"error": "not_found"})
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

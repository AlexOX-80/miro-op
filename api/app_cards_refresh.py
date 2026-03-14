from __future__ import annotations

import traceback

from ._lib import build_service, json_response, parse_json_body, query_param


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") != "PATCH":
        return json_response(start_response, 405, {"error": "method_not_allowed"})
    app_card_id = query_param(environ, "app_card_id")
    if not app_card_id:
        return json_response(start_response, 400, {"error": "missing_app_card_id"})
    service = build_service(environ=environ)
    fallback_work_package_id = query_param(environ, "work_package_id")
    board_id = query_param(environ, "board_id")
    action = query_param(environ, "action")
    try:
        fallback_id = int(fallback_work_package_id) if fallback_work_package_id and fallback_work_package_id.isdigit() else None
        if action == "status":
            payload = parse_json_body(environ)
            status_name = str(payload.get("statusName", "")).strip()
            if not status_name:
                return json_response(start_response, 400, {"error": "missing_status_name"})
            result = service.update_story_status_for_app_card(
                app_card_id,
                status_name,
                fallback_id,
                board_id,
            )
        else:
            result = service.refresh_app_card(
                app_card_id,
                fallback_id,
                board_id,
            )
    except KeyError:
        return json_response(start_response, 404, {"error": "not_found"})
    except ValueError as exc:
        return json_response(start_response, 400, {"error": str(exc)})
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
    return json_response(start_response, 200, result)

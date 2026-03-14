from __future__ import annotations

from ._lib import build_service, json_response


def app(environ, start_response):
    service = build_service()
    return json_response(start_response, 200, {"items": service.list_stories()})

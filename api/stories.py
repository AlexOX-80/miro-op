from __future__ import annotations

from ._lib import build_service, json_response, query_param


def app(environ, start_response):
    service = build_service()
    version_name = query_param(environ, "version_name")
    items = service.list_stories_for_version(version_name) if version_name else service.list_stories()
    return json_response(start_response, 200, {"items": items})

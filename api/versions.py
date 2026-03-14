from __future__ import annotations

from ._lib import build_service, json_response, query_param


def app(environ, start_response):
    service = build_service()
    limit = query_param(environ, "limit")
    limit_value = int(limit) if limit and limit.isdigit() else 5
    return json_response(start_response, 200, {"items": service.list_recent_versions(limit=limit_value)})

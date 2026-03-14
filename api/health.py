from __future__ import annotations

from ._lib import json_response


def app(environ, start_response):
    return json_response(start_response, 200, {"status": "ok"})

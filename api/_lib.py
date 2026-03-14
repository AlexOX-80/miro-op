from __future__ import annotations

import json
from typing import Any

from miro_app_backend.service import MiroAppCardService
from miro_app_backend.settings import load_settings
from miro_app_backend.store import LinkStore


def build_service(env_file: str = ".env") -> MiroAppCardService:
    settings = load_settings(env_file)
    store = LinkStore(settings.data_file)
    return MiroAppCardService(settings, store)


def json_response(start_response, status: int, payload: Any) -> list[bytes]:
    body = json.dumps(payload).encode("utf-8")
    reason = {
        200: "OK",
        400: "BAD REQUEST",
        404: "NOT FOUND",
        405: "METHOD NOT ALLOWED",
        500: "INTERNAL SERVER ERROR",
    }.get(status, "OK")
    start_response(
        f"{status} {reason}",
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
        ],
    )
    return [body]


def parse_json_body(environ: dict[str, Any]) -> dict[str, Any]:
    try:
        length = int(environ.get("CONTENT_LENGTH") or "0")
    except ValueError:
        length = 0
    raw = environ["wsgi.input"].read(length) if length else b"{}"
    return json.loads(raw.decode("utf-8") or "{}")


def query_param(environ: dict[str, Any], key: str) -> str | None:
    query_string = environ.get("QUERY_STRING", "")
    for pair in query_string.split("&"):
        if not pair:
            continue
        name, _, value = pair.partition("=")
        if name == key:
            return value
    return None

from __future__ import annotations

import json
from typing import Any
from http import cookies
from urllib.parse import unquote_plus

from miro_app_backend.service import MiroAppCardService
from miro_app_backend.settings import load_settings
from miro_app_backend.store import LinkStore, TokenStore


def build_service(env_file: str = ".env", environ: dict[str, Any] | None = None) -> MiroAppCardService:
    settings = load_settings(env_file)
    store = LinkStore(settings.data_file)
    token_store = TokenStore(settings.data_file.with_name("oauth_token.json"))
    header_token = None
    if environ:
        header_token = environ.get("HTTP_X_MIRO_OAUTH_TOKEN")
    return MiroAppCardService(
        settings,
        store,
        token_store,
        access_token_override=header_token or get_cookie(environ or {}, "miro_oauth_token"),
    )


def json_response(start_response, status: int, payload: Any, headers: list[tuple[str, str]] | None = None) -> list[bytes]:
    body = json.dumps(payload).encode("utf-8")
    reason = {
        200: "OK",
        400: "BAD REQUEST",
        404: "NOT FOUND",
        405: "METHOD NOT ALLOWED",
        500: "INTERNAL SERVER ERROR",
    }.get(status, "OK")
    response_headers = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
    ]
    if headers:
        response_headers.extend(headers)
    start_response(f"{status} {reason}", response_headers)
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
            return unquote_plus(value)
    return None


def get_cookie(environ: dict[str, Any], key: str) -> str | None:
    raw = environ.get("HTTP_COOKIE", "")
    if not raw:
        return None
    jar = cookies.SimpleCookie()
    jar.load(raw)
    morsel = jar.get(key)
    if not morsel:
        return None
    return morsel.value

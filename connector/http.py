from __future__ import annotations

import json
from typing import Any
from urllib import error, parse, request


class HttpClient:
    def __init__(self, base_url: str, default_headers: dict[str, str]) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_headers = default_headers

    def get_json(self, path: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
        url = self._build_url(path, query)
        req = request.Request(url, headers=self.default_headers, method="GET")
        return self._send(req)

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = self._build_url(path, None)
        body = json.dumps(payload).encode("utf-8")
        headers = {**self.default_headers, "Content-Type": "application/json"}
        req = request.Request(url, headers=headers, data=body, method="POST")
        return self._send(req)

    def patch_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = self._build_url(path, None)
        body = json.dumps(payload).encode("utf-8")
        headers = {**self.default_headers, "Content-Type": "application/json"}
        req = request.Request(url, headers=headers, data=body, method="PATCH")
        return self._send(req)

    def delete(self, path: str) -> None:
        url = self._build_url(path, None)
        req = request.Request(url, headers=self.default_headers, method="DELETE")
        self._send(req)

    def iter_collection(self, path: str, query: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        cursor: str | None = None

        while True:
            page_query = dict(query or {})
            if cursor:
                page_query["cursor"] = cursor
            response = self.get_json(path, query=page_query)
            items.extend(response.get("data", []))
            cursor = response.get("cursor")
            if not cursor:
                break
        return items

    def _build_url(self, path: str, query: dict[str, Any] | None) -> str:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if query:
            url = f"{url}?{parse.urlencode(query)}"
        return url

    def _send(self, req: request.Request) -> dict[str, Any]:
        try:
            with request.urlopen(req) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} for {req.full_url}: {details}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Request failed for {req.full_url}: {exc.reason}") from exc

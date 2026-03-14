from __future__ import annotations

import argparse
import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse

from .service import MiroAppCardService
from .settings import AppBackendSettings, load_settings
from .store import LinkStore


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "miro_app_frontend"


class AppRequestHandler(BaseHTTPRequestHandler):
    service: MiroAppCardService
    settings: AppBackendSettings

    def do_GET(self) -> None:
        parsed = parse.urlparse(self.path)
        path = parsed.path
        if path == "/health":
            self._write_json({"status": "ok"})
            return
        if path == "/api/config":
            self._write_json(
                {
                    "boardId": self.settings.miro_board_id,
                    "versionName": self.settings.openproject_version_name,
                    "appPublicUrl": self.settings.app_public_url,
                }
            )
            return
        if path == "/api/setup":
            self._write_json(
                {
                    "appUrl": f"{self.settings.app_public_url}/",
                    "connectModalUrl": f"{self.settings.app_public_url}/connect.html",
                    "openModalUrl": f"{self.settings.app_public_url}/modal.html",
                    "healthUrl": f"{self.settings.app_public_url}/health",
                    "storiesApiUrl": f"{self.settings.app_public_url}/api/stories",
                    "boardId": self.settings.miro_board_id,
                }
            )
            return
        if path == "/api/stories":
            self._write_json({"items": self.service.list_stories()})
            return
        if path.startswith("/api/app-cards/"):
            app_card_id = path.removeprefix("/api/app-cards/")
            result = self.service.get_connection(app_card_id)
            if result is None:
                self._write_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)
                return
            self._write_json(result)
            return
        self._serve_static(path)

    def do_POST(self) -> None:
        if self.path == "/api/app-cards/connect":
            body = self._read_json()
            result = self.service.connect_app_card(
                app_card_id=str(body["appCardId"]),
                work_package_id=int(body["workPackageId"]),
            )
            self._write_json(result)
            return
        self._write_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:
        if self.path.startswith("/api/app-cards/") and self.path.endswith("/refresh"):
            app_card_id = self.path.split("/")[3]
            result = self.service.refresh_app_card(app_card_id)
            self._write_json(result)
            return
        self._write_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args) -> None:  # pragma: no cover
        return

    def _read_json(self) -> dict[str, object]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        return json.loads(raw_body or "{}")

    def _write_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, path: str) -> None:
        relative = "index.html" if path in {"/", ""} else path.lstrip("/")
        file_path = (FRONTEND_DIR / relative).resolve()
        if not str(file_path).startswith(str(FRONTEND_DIR.resolve())) or not file_path.exists():
            self._write_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)
            return
        content_type, _ = mimetypes.guess_type(str(file_path))
        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def build_handler(service: MiroAppCardService, settings: AppBackendSettings):
    class Handler(AppRequestHandler):
        pass

    Handler.service = service
    Handler.settings = settings
    return Handler


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run local backend for connected Miro app cards.")
    parser.add_argument("--env-file", default=".env", help="Path to env file")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    settings = load_settings(args.env_file)
    store = LinkStore(settings.data_file)
    service = MiroAppCardService(settings, store)
    server = ThreadingHTTPServer(
        (settings.backend_host, settings.backend_port),
        build_handler(service, settings),
    )
    print(f"Miro app backend listening on http://{settings.backend_host}:{settings.backend_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:  # pragma: no cover
        pass
    finally:
        server.server_close()
    return 0

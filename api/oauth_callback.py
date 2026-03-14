from __future__ import annotations

import html
import json
from urllib import parse, request

from ._lib import build_service, json_response, query_param


def app(environ, start_response):
    code = query_param(environ, "code")
    if not code:
        return json_response(start_response, 400, {"error": "missing_code"})

    service = build_service(environ=environ)
    settings = service.settings
    if not settings.miro_client_id or not settings.miro_client_secret:
        return json_response(start_response, 400, {"error": "missing_miro_oauth_credentials"})

    token_request = request.Request(
        "https://api.miro.com/v1/oauth/token",
        data=parse.urlencode(
            {
                "grant_type": "authorization_code",
                "client_id": settings.miro_client_id,
                "client_secret": settings.miro_client_secret,
                "code": code,
                "redirect_uri": settings.miro_oauth_redirect_uri,
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(token_request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return json_response(start_response, 500, {"error": f"oauth_exchange_failed: {exc}"})

    access_token = payload.get("access_token")
    if not access_token:
        return json_response(start_response, 500, {"error": "missing_access_token"})

    service.save_oauth_token(str(access_token))
    body = f"""<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>Miro OAuth verbunden</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {{ font-family: sans-serif; padding: 24px; line-height: 1.4; }}
      code {{ background: #f3f3f3; padding: 2px 6px; border-radius: 4px; }}
    </style>
  </head>
  <body>
    <h1>Miro OAuth verbunden</h1>
    <p>Der Token wurde fuer diese App gespeichert.</p>
    <p>Du kannst dieses Fenster jetzt schliessen und den Connect-Dialog erneut oeffnen.</p>
    <script>
      localStorage.setItem("miro_oauth_token", {json.dumps(str(access_token))});
    </script>
    <p><code>status: ok</code></p>
  </body>
</html>"""
    encoded = body.encode("utf-8")
    start_response(
        "200 OK",
        [
            ("Content-Type", "text/html; charset=utf-8"),
            ("Content-Length", str(len(encoded))),
            ("Cache-Control", "no-store"),
            (
                "Set-Cookie",
                f"miro_oauth_token={html.escape(str(access_token), quote=True)}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=None",
            ),
        ],
    )
    return [encoded]

# OpenProject / Miro Connector

Erster Use Case: User Stories einer angegebenen OpenProject-Version projektuebergreifend laden und als Kanban-Karten in Miro anlegen.

## Stand

Aktuell implementiert:

- OpenProject Work Packages ueber `/api/v3/work_packages` laden
- Filter nach Version und Typ "User story"
- Karten pro Story auf einem Miro-Board anlegen
- Vorhandene Miro-Karten derselben OpenProject-ID aktualisieren statt duplizieren
- Spaltenposition anhand des OpenProject-Status bestimmen
- Grundgeruest fuer connected Miro app cards mit lokalem Backend und Web-App

Noch offen:

- Zammad-Anbindung
- produktiver Miro-App-Installationsflow
- Webhook- oder Zeitplan-Ausfuehrung fuer app-card refresh

## Voraussetzungen

- Python 3.12+
- Ein OpenProject API Token
- Ein Miro Access Token mit Schreibrechten auf das Ziel-Board

## Konfiguration

1. `.env.example` nach `.env` kopieren
2. Werte anpassen

Wichtige Variablen:

- `OPENPROJECT_AUTH_MODE`: `basic` fuer klassische API-Tokens, `bearer` fuer OAuth/JWT oder neue Bearer-faehige Tokens
- `OPENPROJECT_VERSION_NAME`: Versionsname bzw. Release-Name, nach dem gefiltert wird
- `OPENPROJECT_STORY_TYPE`: Standard ist `User story`
- `MIRO_ASSIGNEE_MAP_JSON`: optionales Mapping von OpenProject-Benutzer-ID oder -Name auf Miro `board_member_id`
- `MIRO_COLUMNS_JSON`: Ordnet Statusnamen feste X/Y-Koordinaten auf dem Board zu

## Ausfuehrung

```bash
python -m connector
```

Optional mit anderer Env-Datei:

```bash
python -m connector --env-file .env.local
```

Dry Run ohne Miro-Schreibzugriff:

```bash
python -m connector --dry-run
```

Neue Karten immer erzwingen:

```bash
python -m connector --no-sync-existing
```

## Connected App Cards

Der neue Ansatz fuer bearbeitbare, verbundene Miro-App-Cards besteht aus:

- statischem Frontend aus `miro_app_frontend/`
- API-Funktionen unter `api/`
- optional lokalem Backend fuer Entwicklung: `python -m miro_app_backend`
- OpenProject als Quellsystem
- Miro App Card REST + Web SDK fuer `connect` und `open`

Lokaler Start:

```bash
python -m miro_app_backend
```

Danach liefert das Backend:

- `GET /health`
- `GET /api/stories`
- `POST /api/app-cards/connect`
- `PATCH /api/app-cards/{app_card_id}/refresh`

Frontend-Dateien liegen in `miro_app_frontend/`.

Setup-Hilfe:

```bash
https://<deine-vercel-domain>/setup.html
```

Fuer Deployment nach Vercel liegt die Konfiguration in `vercel.json`.

Wichtige neue Variablen:

- `MIRO_APP_PUBLIC_URL`: oeffentliche URL, unter der Miro das Frontend erreicht
- `MIRO_CLIENT_ID`
- `MIRO_CLIENT_SECRET`
- `MIRO_OAUTH_REDIRECT_URI`
- `APP_BACKEND_HOST`
- `APP_BACKEND_PORT`
- `APP_DATA_FILE`: lokale Mapping-Datei fuer `app_card_id -> work_package_id`

## Technische Annahmen

- OpenProject stellt Versionen ueber das Work-Package-Feld `version` bereit.
- Die REST-Abfrage ist projektuebergreifend und filtert zentral ueber `/api/v3/work_packages`.
- In Miro werden Karten ueber den Endpoint `/boards/{board_id}/cards` angelegt und ueber `/boards/{board_id}/items?type=card` wiedergefunden.
- Die stabile Zuordnung erfolgt ueber die Zeile `OpenProject ID: <id>` in der Kartenbeschreibung.
- Connected App Cards werden ueber ein lokales Mapping in `APP_DATA_FILE` OpenProject-Stories zugeordnet.

Wenn eure OpenProject-Instanz Feldnamen oder Typbezeichnungen anders liefert, muessen die Mapping-Regeln im Code leicht angepasst werden.

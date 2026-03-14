# Miro App Setup

## Vercel Deployment

Deploye das Repo nach Vercel. Danach setze in Vercel mindestens diese Environment-Variablen:

- `OPENPROJECT_BASE_URL`
- `OPENPROJECT_API_TOKEN`
- `OPENPROJECT_AUTH_MODE`
- `OPENPROJECT_VERSION_NAME`
- `OPENPROJECT_STORY_TYPE`
- `MIRO_BASE_URL`
- `MIRO_ACCESS_TOKEN`
- `MIRO_BOARD_ID`
- `MIRO_APP_PUBLIC_URL`
- `APP_DATA_FILE`

`MIRO_APP_PUBLIC_URL` muss auf die produktive Vercel-Domain zeigen, zum Beispiel:

```text
https://op-zammad-miro-connector.vercel.app
```

## Eintraege in der Miro Developer Console

Nach dem Deployment:

1. `https://<deine-domain>/setup.html` oeffnen
2. dort die URLs ablesen
3. in der Miro Developer Console eintragen

Typische Werte:

- App URL: `https://<deine-domain>/`
- Modal fuer Connect: `https://<deine-domain>/connect.html`
- Modal fuer Open: `https://<deine-domain>/modal.html`

## Benoetigte Frontend-Einstiege

- Hauptansicht: `/`
- Setup-Hilfe: `/setup.html`
- Connect-Dialog: `/connect.html`
- Open-Dialog: `/modal.html`

## Ziel-Flow

1. Repo nach Vercel deployen
2. Setup-Seite auf der Vercel-Domain oeffnen
3. Miro-App in der Developer Console konfigurieren
4. App auf dem Board installieren
5. Disconnected App Card anlegen
6. App Card ueber Connect mit einer OpenProject Story verknuepfen

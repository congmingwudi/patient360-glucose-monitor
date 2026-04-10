# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start production server (node server.js)
npm run dev        # Start dev server with auto-reload (nodemon)
npm install        # Install dependencies

docker-compose up  # Build and run with Docker (port 3000, reads .env)
docker build -t glucose-monitor .
docker run -p 3000:3000 --env-file .env glucose-monitor
```

No test suite exists in this project.

## Architecture

This is a single-page glucose monitoring simulator that sends readings to **Salesforce Data Cloud** via their Ingestion API.

**Stack:** Node.js/Express backend + vanilla JS frontend (no build step). Static files served from `public/`.

**Data flow:**
1. User adjusts slider in browser (20–400 mg/dL). The browser classifies the reading into a `level` enum **client-side** in `public/app.js` (`classifyLevel` + `THRESHOLDS` constants — 54 / 70 / 180 / 250 mg/dL boundaries) and submits.
2. `POST /api/glucose` on the Express server receives `{ patientId, bloodSugarReading, level }` and stamps an `eventId` (UUID) and `dateTimeStamp` server-side. It does **not** re-validate `level` against the reading — change thresholds in `app.js`, not `server.js`.
3. Server performs a **2-step OAuth2 flow** to get a Data Cloud-specific token:
   - Step 1: Client Credentials grant against `SF_TOKEN_URL` → standard Salesforce access token + `instance_url`
   - Step 2: Token exchange (`urn:salesforce:grant-type:external:cdp`) against `${instance_url}/services/a360/token` → Data Cloud tenant token. Note: this uses the Step-1 instance URL, **not** `SF_DATA_CLOUD_URL`.
4. Token is cached in memory (invalidated at 90% of lifetime, or on 401/403 from the Ingestion call).
5. Server posts the event payload to the Salesforce Data Cloud Ingestion API.

**Key endpoints:**
- `GET /api/config` — returns `DEFAULT_PATIENT_ID` from env
- `POST /api/glucose` — validates input, obtains token, sends to Salesforce

**Event schema** is defined in `GlucoseMonitorEvent.yaml` (OpenAPI 3.0.3). Fields: `eventId` (UUID), `patientId`, `dateTimeStamp` (ISO 8601 UTC), `bloodSugarReading` (mg/dL), `level` (enum: Dangerously Low / Low / Normal / High / Dangerously High).

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Purpose |
|---|---|
| `SF_CLIENT_ID` | Salesforce Connected App client ID |
| `SF_CLIENT_SECRET` | Salesforce Connected App client secret |
| `SF_TOKEN_URL` | Salesforce OAuth token endpoint |
| `SF_DATA_CLOUD_URL` | Data Cloud tenant base URL |
| `SF_INGESTION_SOURCE` | Ingestion API source name (e.g. `GlucoseMonitorEvent`) |
| `DEFAULT_PATIENT_ID` | Pre-filled patient ID in the UI |
| `PORT` | Server port (default 3000) |

The Ingestion API endpoint is constructed as:
```
{SF_DATA_CLOUD_URL}/api/v1/ingest/sources/{SF_INGESTION_SOURCE}/GlucoseMonitorEvent
```
The trailing `GlucoseMonitorEvent` is the **object name** and is hardcoded in `server.js` — it is not the same as `SF_INGESTION_SOURCE` (which is the source/connector name).

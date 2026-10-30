# File Extraction Agent

A standalone eve agent for extracting user-requested fields from files supplied in the conversation.

## Configure extraction fields

Edit `agent/instructions.md` and update **Fields to extract** with the fields you need (for example, MSN number).

## Run

From this folder, install dependencies and start the eve development server:

```bash
npm install
eve dev
```

Set `OPENROUTER_API_KEY` in the environment before running. Users can provide a local PDF path for single-file extraction, ask to prepare a folder, or ask to run the full pipeline. The `process_folder` workflow prepares, classifies, and extracts supported documents in one run. The `prepare_documents` tool reads regular files directly inside the specified folder (it does not recurse), converts supported files to Markdown with LiteParse, and saves sidecars under `output/<sessionId>/documents/`. File paths refer to the machine running the agent; in a deployed service, files must be present on that service or uploaded to it. Office document parsing may require LibreOffice in the runtime environment.

## Run in Docker

The Docker image uses Node.js 24 and installs LibreOffice Writer, Calc, and Impress for LiteParse Office-document conversion. To run locally with persistent storage:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY (and database settings if needed)
docker compose up --build -d
```

The service is published on `127.0.0.1:3000` by default. Set `APP_PORT` in `.env` to change the host port. The Eve server listens on port `3000` inside the container. Compose mounts `./data` at `/data` for application-managed files and `./data/output` at `/app/output` for the workflow's existing output paths. Both persist when the container is stopped or recreated.

The upload API accepts one or more files in the `files` multipart field. The default target reporting period is `August 2026`; callers may override it with a full month/year `reportingPeriod` field. This is the target period for the run, not a requirement that every uploaded file have that period: you may upload a mixed-period folder in one request. Documents matching the target period proceed to validation and extraction; documents from other periods are recorded as skipped before database validation. To extract multiple periods, submit a separate request for each target period. Supported extensions are `.pdf`, `.docx`, `.xlsx`, `.doc`, `.xls`, `.pptx`, `.odt`, `.ods`, `.odp`, `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`, and `.webp`. It accepts only supported document extensions, not a caller-supplied filesystem path. The API is intended for local use only: Compose publishes it on loopback and no API authentication is configured. Do not expose it to a network or the public internet.

Upload all files you want considered in one run. With no `reportingPeriod` field, this processes August 2026 documents and marks September 2026 or August 2025 documents as skipped:

```bash
curl -F 'files=@./august-report.pdf' -F 'files=@./september-report.pdf' -F 'files=@./older-report.pdf' http://localhost:3000/api/runs
```

On Windows PowerShell 5.1, use `curl.exe` for multipart uploads (its `Invoke-RestMethod` does not support `-Form`). Add one `-F` argument per file, including every file in the folder. The API defaults the target to August 2026; add a `reportingPeriod` field only when targeting a different month.

A successful upload returns HTTP `202` with a generated `runId` and `queued` status, then starts the existing `process_folder` workflow asynchronously. Files are saved under `./data/uploads/<runId>/`; run metadata, status, and structured result are written under `./data/runs/<runId>/`. Poll progress and retrieve the final result with:

```bash
RUN_ID="paste-the-run-id-from-upload-response"
curl "http://localhost:3000/api/runs/$RUN_ID"
curl http://localhost:3000/health
```

The run endpoint returns JSON with the run ID and current status. While queued/running, `result` and `error` are null. On completion, `result` contains the structured workflow output with local paths and raw source excerpts removed. On failure, `error` is a concise safe message. An invalid ID returns `400`; a valid but unknown ID returns `404`.

### End-to-end Docker smoke test

With Docker Desktop running, valid model credentials in `.env`, and the app built/started, run:

```bash
docker compose up --build -d
node scripts/smoke-upload-api.mjs
```

The script uploads the supported PDF fixture at `test/fixtures/api-smoke.pdf`, polls the run endpoint, and succeeds only when it retrieves a completed structured result. It uses the live model configuration (and database configuration if supplied), so allow several minutes. You can pass another representative supported file as the script argument. Check logs with `docker compose logs -f app` if the workflow fails.

The status response contains `queued`, `running`, `completed`, or `failed`; `result` is present only for completed runs and `error` is a safe message for failed runs. Local file paths and extracted raw source text are omitted from the returned result. After an application restart, a run still recorded as queued/running is reported as interrupted/failed rather than successful. Upload defaults are 20 files, 25 MiB per file, and 100 MiB per request; override them with `UPLOAD_MAX_FILES`, `UPLOAD_MAX_FILE_BYTES`, and `UPLOAD_MAX_REQUEST_BYTES` in `.env`.

Run automated API tests locally with `npm test`; run `npm run typecheck` and `npm run build` for project validation.

Useful commands:

```bash
docker compose logs -f app   # Follow logs
docker compose stop          # Stop without removing the container
docker compose down          # Remove the container/network; keep host data
docker compose up --build -d # Rebuild and start
```

Uploaded documents and workflow outputs may contain sensitive or customer information. Keep `./data` private and do not commit it. To permanently remove local persisted files, stop the service and delete `./data` manually; this is destructive. `.env`, data, and generated outputs are excluded from version control and the Docker build context. Do not bake secrets into the image.

## Database connection

Database settings are read from `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_DATABASE` in `.env`. The SQL Server connection uses port `1433`. The `check_database_connection` tool runs `SELECT 1` and reads table metadata from `INFORMATION_SCHEMA.TABLES`; it does not modify database data or return credentials.

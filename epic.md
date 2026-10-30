

# Epic 4: Run the application in Docker

## Goal

Package the Eve file-extraction agent and its runtime dependencies as a Dockerized local application. Persist uploaded files and generated outputs on the host so container recreation does not lose run data.

## MVP decisions

- Provide a Docker image and Docker Compose configuration for local use.
- Run on Node.js 24, matching `package.json`.
- Keep uploads and generated run data under a configurable data directory mounted from the host (for example `./data:/data`).
- Supply secrets and configuration through environment variables or an untracked local `.env` file; never bake credentials into the image.
- Include LibreOffice if Office document parsing is expected in the container, and document any other system runtime dependencies.
- Do not expose the service publicly by default; bind the API to localhost for local development.

## Stories and tasks

### Story 4.1: Build a reproducible runtime image

**As a developer,** I need to build and run the agent in a container with the required runtime and parsing dependencies.

#### Implementation steps

1. Add a Dockerfile using a Node 24 base image, install production dependencies, and provide build/start commands consistent with the Eve project.
2. Install LibreOffice and any required OS libraries for LiteParse-supported Office formats; avoid installing unrelated tools.
3. Add a `.dockerignore` that excludes `node_modules`, local secrets, generated output, and other unnecessary build context.
4. Ensure the container starts the Eve application and listens on an explicitly configured host/port reachable from the host.
5. Add a health check if the application exposes a health endpoint.

#### Acceptance criteria

- A clean Docker build succeeds from the repository without relying on host `node_modules`.
- The container starts the Eve app and can process a representative supported document.
- Required runtime dependencies and limitations are documented.
- Secrets are not present in image layers or committed configuration.

### Story 4.2: Persist local data with Docker Compose

**As a local operator,** I need uploaded inputs and workflow outputs to persist across container restarts.

#### Implementation steps

1. Add `docker-compose.yml` with the application service, configurable port, environment variables, and a host-mounted data directory.
2. Use `/data` as the stable in-container location for uploads and API-managed run metadata; configure workflow output to persist as well.
3. Add an `.env.example` listing required and optional variables without real credentials, and ensure `.env` is ignored by version control.
4. Document build, start, stop, logs, and cleanup commands, including the location and sensitivity of persisted files.

#### Acceptance criteria

- `docker compose up --build` starts the application locally with a persistent host volume.
- Upload and output data remain available after stopping and recreating the container.
- Port and data-directory configuration are documented and overridable.
- No secrets or customer files are committed.

## Out of scope

- Cloud deployment, orchestration, autoscaling, remote object storage, and production TLS/reverse proxy setup.
- Authentication/authorization beyond safeguards needed for a localhost-only MVP.
- Automatic deletion/retention policies for uploaded documents.

## Definition of done

- Dockerfile, Compose configuration, ignore rules, and environment example are added.
- The application and document-processing dependencies work in the container.
- Local persistence and setup are verified and documented.

# Epic 5: Upload files and invoke the workflow through an API

## Goal

Allow a local client to upload documents to the Dockerized application, have the application store them locally, and invoke the existing `process_folder` Eve workflow using the stored directory instead of requiring the user to provide a machine-local folder path.

## MVP decisions

- Accept multipart file uploads over HTTP.
- Store each run under a unique, server-generated ID in the persistent `/data` volume, for example `/data/uploads/<runId>/`.
- The server, not the caller, determines filesystem paths. Never accept arbitrary folder paths from API input.
- Start work asynchronously and return a run ID; clients query a status/result endpoint.
- Pass the server-created upload directory as `folderPath` to the existing workflow. Preserve Eve session identity and associate the API run ID with the workflow session ID and outputs.
- Keep the API local-only by default. Set upload count/size limits, validate filenames/extensions, and prevent path traversal.
- Do not return uploaded document contents in status/result responses.

## API contract (MVP)

- `POST /api/runs` — multipart form with one or more files and optional `reportingPeriod`; returns `202 Accepted` with `{ "runId": "...", "status": "queued" }`.
- `GET /api/runs/:runId` — returns `{ "runId": "...", "status": "queued|running|completed|failed", "result": ..., "error": ... }`; result/error are populated when available.
- `GET /health` — lightweight liveness/health response for local operation and container checks.

## Stories and tasks

### Story 5.1: Add a local upload API

**As a user,** I need to upload a set of documents without knowing or supplying a server filesystem path.

#### Implementation steps

1. Add an HTTP API server integrated with the Eve application lifecycle and expose it on the configured local port.
2. Implement `POST /api/runs` as multipart upload handling with configurable maximum request size, file count, and per-file size.
3. Generate an unguessable run ID; create a dedicated directory under the configured data root and save uploaded regular files there.
4. Normalize/sanitize filenames, reject path traversal and unsupported file types according to the preparation workflow's supported-extension policy, and avoid overwriting duplicate names.
5. Validate optional `reportingPeriod`; do not accept a caller-provided filesystem path or session ID.
6. Return a clear client error for invalid/empty uploads and ensure partial upload failures do not leave a run that appears valid.

#### Acceptance criteria

- A valid multipart request saves every accepted file under that run's directory and returns a generated run ID.
- Caller filenames cannot escape the run directory or overwrite files unexpectedly.
- Upload limits and unsupported inputs produce useful 4xx responses.
- Uploaded files are on the persistent Docker volume and never placed inside the image filesystem as the durable copy.

### Story 5.2: Invoke the Eve workflow for an uploaded run

**As a user,** I need the uploaded files to be processed by the existing `process_folder` workflow.

#### Implementation steps

1. Integrate workflow invocation with the deployed Eve runtime using the supported Eve workflow/tool invocation mechanism; do not shell out to an interactive CLI for each request.
2. Pass the server-generated upload directory as `folderPath` and forward the optional reporting period.
3. Track run state transitions (`queued`, `running`, `completed`, `failed`) and associate the Eve session/workflow ID with the API run ID.
4. Persist status and the final structured workflow result under `/data/runs/<runId>/`, using atomic writes where appropriate.
5. Handle workflow exceptions and process restarts without reporting false success; return safe error details and log diagnostic context without logging credentials or document contents.
6. Ensure concurrent runs do not share upload/output directories or overwrite one another's state.

#### Acceptance criteria

- A successful upload triggers the existing workflow with the correct server-side directory and reporting period.
- The API can distinguish queued, running, completed, and failed runs and retains the final result across container restart.
- Failures are associated with the correct run and do not block other runs.
- Workflow output behavior and existing non-API usage remain compatible.

### Story 5.3: Add run status/result and health endpoints

**As a client,** I need to retrieve run progress and results without keeping the upload request open.

#### Implementation steps

1. Implement `GET /api/runs/:runId`, loading run state from persisted run metadata.
2. Return 404 for unknown run IDs; do not permit directory traversal through the ID parameter.
3. Return structured results only after completion, and a concise safe error when failed.
4. Implement `GET /health` and configure Docker Compose health checking against it.
5. Add request validation, consistent JSON error responses, and appropriate HTTP status codes.

#### Acceptance criteria

- Clients can poll a run and observe correct state transitions and final structured results.
- Unknown IDs return 404; malformed requests return a 4xx response; server errors do not leak stack traces or secrets.
- Health endpoint is available for local Docker health checks.
- Result responses do not expose local absolute paths or document text unless explicitly part of the workflow's intended structured result.

### Story 5.4: Test and document upload-to-workflow operation

**As the team,** we need to verify the complete local API flow and give users reproducible instructions.

#### Implementation steps

1. Add tests for multipart validation, filename sanitization, limits, persistence, run state transitions, workflow success/failure, result retrieval, and unknown IDs.
2. Mock the workflow invocation for fast API tests; add a documented end-to-end smoke test using a supported fixture and the local Docker deployment.
3. Document `curl` examples for uploading multiple files, polling status, and interpreting results.
4. Document API limitations, local-only exposure, upload storage location, cleanup, and supported file types.
5. Run typecheck, build, tests, and the Docker smoke test.

#### Acceptance criteria

- Automated tests cover API validation, security-sensitive path handling, persistence, and success/failure behavior.
- The documented smoke test uploads a file and retrieves a completed result through the API.
- API and container setup instructions match the implementation and do not suggest arbitrary filesystem-path input is supported.

## Out of scope

- Cloud buckets, direct-to-object-storage signed uploads, remote deployment, public API authentication, and multi-tenant authorization.
- Web UI, streaming progress, cancellation, retries, and scheduled retention/deletion.
- Changing classification/extraction behavior unrelated to adapting the workflow to API-uploaded local files.

## Dependencies and rollout

- Depends on Epic 4's Docker runtime and persistent data volume.
- Verify Eve's programmatic workflow invocation mechanism against the installed Eve version before implementation; keep the API adapter isolated so the workflow can be invoked without changing its business logic.
- Start with localhost binding and representative PDF/document smoke tests. Treat exposure beyond the local machine as out of scope until authentication and deployment security are designed.

## Definition of done

- A client can upload files, receive a run ID, poll status, and retrieve structured workflow results.
- Files and run metadata persist in the mounted local data directory.
- The API invokes the existing Eve workflow using the server-created upload directory, with safe validation and isolated concurrent runs.
- Tests, typecheck, build, Docker smoke test, and README/API instructions pass.

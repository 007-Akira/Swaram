# Swaram

[![CI](https://github.com/007-Akira/Swaram/actions/workflows/ci.yml/badge.svg)](https://github.com/007-Akira/Swaram/actions/workflows/ci.yml)

Swaram is a Malayalam-only, privacy-focused singing pitch-practice
application. The project is under active, phase-by-phase development.

## Repository layout

- `apps/web` — Next.js App Router frontend
- `services/api` — FastAPI application
- `services/worker` — dedicated PostgreSQL worker process
- `packages/contracts` — cross-service contract package
- `packages/audio-core` — browser audio primitives
- `packages/ui` — shared UI primitives
- `data/uploads` and `data/processed` — private local runtime storage

Redis, Celery, RQ, and MinIO are intentionally not part of the MVP.

## Prerequisites

- Node.js 20+
- pnpm 9
- Python 3.11+
- PostgreSQL 15+

## Initial setup

```bash
cp .env.example .env
pnpm install --frozen-lockfile
python -m venv .venv
. .venv/bin/activate
python -m pip install -e packages/contracts -e "services/api[dev]" -e "services/worker[dev]"
```

Run the API and web application together after activating the Python virtual
environment:

```bash
pnpm dev
```

Alternatively, run `pnpm dev:web` and `pnpm dev:api` in separate terminals.
The web application uses <http://localhost:3000>; API liveness and database
readiness are available at <http://localhost:8000/health> and
<http://localhost:8000/ready>. API startup never applies migrations; run
`pnpm db:upgrade` explicitly.

The worker normally polls continuously. Verify one PostgreSQL-backed idle cycle
and exit cleanly with `pnpm worker:once`.
The hardened non-root CPU/GPU container profiles and orchestration health check
are documented in [the worker deployment guide](docs/worker-deployment.md).

## Private session API

`POST /api/v1/sessions` creates an expiring private session and returns its
access token once. Send that secret as `X-Session-Token` for every session,
upload, playback, and deletion request. The database stores only its SHA-256
hash. Audio uploads are limited by `UPLOAD_MAX_BYTES` and
`AUDIO_MAX_DURATION_SECONDS`; decoded PCM is limited by
`DECODED_AUDIO_MAX_BYTES`, and each session is limited by
`MAX_AUDIO_ASSETS_PER_SESSION`. FFprobe verifies actual decodability and checks
that detected MP3, WAV, M4A, or FLAC content agrees with the declared MIME type
and extension. TXT/LRC/SRT lyrics must be UTF-8 and
are normalized to Unicode NFC.

Objects are stored under `PRIVATE_DATA_ROOT/private` with random keys and
mode-restricted directories. Paths and permanent public URLs are never
returned. Authorized playback supports HTTP byte ranges through the API.
Sessions expire after `SESSION_RETENTION_HOURS` (24 hours by default).

Run `swaram-cleanup --dry-run` to audit which expired session IDs would be
removed, then run `swaram-cleanup` from a scheduler to delete their original
uploads, generated derivatives, analysis artifacts, recordings, and database
records. Cleanup is idempotent and retries sessions whose storage deletion
previously failed. Audit logs contain identifiers and outcomes only—never
lyrics, tokens, or file contents. Users should therefore treat uploads as
temporary and export no data through Swaram; deletion can also be requested
immediately through the session API.

See
[the architecture overview](docs/architecture.md) for component boundaries.
Security boundaries, concrete controls, deployment requirements, and residual
risks are recorded in [the threat model](docs/threat-model.md).
PostgreSQL setup and migration commands are documented in
[the database guide](docs/database.md).

## Quality gates

The GitHub Actions workflow requires no GPU, Docker daemon, external secrets,
or running database for unit checks. Its separate integration job supplies an
ephemeral PostgreSQL service.

Run the local equivalents with:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
.venv/bin/ruff check services packages/contracts
.venv/bin/ruff format --check services packages/contracts
.venv/bin/mypy services/api/src services/worker/src packages/contracts/python
.venv/bin/pytest -m "not integration"
```

Database integration tests require an explicit disposable
`TEST_DATABASE_URL`; see [the database guide](docs/database.md).

Authorized WAV reference contour generation is documented in
[the offline contour guide](docs/reference-contour.md).
Browser YIN frame sizing and sample-rate trade-offs are documented in
[the pitch detection guide](docs/browser-pitch-detection.md).
Secure microphone lifecycle behavior is documented in
[the microphone capture guide](docs/microphone-capture.md).
The worker's bounded FFmpeg normalization contract is documented in
[the audio processing guide](docs/audio-processing.md).

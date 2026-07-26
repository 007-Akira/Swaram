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

See
[the architecture overview](docs/architecture.md) for component boundaries.
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

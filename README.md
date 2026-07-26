# Swaram

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

See
[the architecture overview](docs/architecture.md) for component boundaries.
PostgreSQL setup and migration commands are documented in
[the database guide](docs/database.md).

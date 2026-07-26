# Production deployment

## Container option

The production Compose example builds multi-stage, non-root web and API images
plus the isolated worker image. Only Nginx publishes ports. PostgreSQL and the
worker remain on an internal network; uploaded content is stored only in the
shared private volume. No secrets or media are copied into images because the
root `.dockerignore` excludes environment files, data, prompt packs, and
private media.

Set `POSTGRES_PASSWORD`, `SWARAM_DOMAIN`, and `TLS_CERTIFICATE_DIR`, build the
images, run migrations as a controlled one-off step, and then start services:

```bash
docker compose -f infra/docker-compose.production.yml build
docker compose -f infra/docker-compose.production.yml run --rm api \
  alembic -c /app/services/api/alembic.ini upgrade head
docker compose -f infra/docker-compose.production.yml up -d
```

The API image contains no FFmpeg or ML packages. The CPU worker image contains
FFmpeg, pinned HTDemucs/PyTorch dependencies, and a pre-provisioned model.
The GPU profile requires a separately validated CUDA base as described in the
worker deployment guide. Record image sizes with `docker images` after a real
build; Docker is unavailable in the current development environment, so no
sizes are claimed here.

## Non-container single VPS

Use a dedicated `swaram` system account with no interactive login. Install
Node.js 20, pnpm 9.15.9, Python 3.11, PostgreSQL 16, Nginx, FFmpeg, and the
worker's optional `audio-ml` dependencies. Clone the engine repository to
`/opt/swaram`, create `/opt/swaram/.venv`, build the web app, and create
`/var/lib/swaram` owned only by `swaram` with mode `0700`.

Keep `/etc/swaram/api.env`, `/etc/swaram/worker.env`, and
`/etc/swaram/web.env` root-owned and mode `0600`. They must set production
database credentials, exact HTTPS CORS origin, public API URL, private data
root, retention/resource controls, and CPU/GPU device. Never place tokens,
uploads, lyrics, or model output in the repository.

Create three systemd services:

- `swaram-api`: `uvicorn swaram_api.main:app --host 127.0.0.1 --port 8000`;
- `swaram-web`: `node apps/web/.next/standalone/apps/web/server.js`, bound to
  `127.0.0.1:3000`;
- `swaram-worker`: `.venv/bin/swaram-worker`, with `PrivateTmp=true`,
  `NoNewPrivileges=true`, `ProtectSystem=strict`,
  `ReadWritePaths=/var/lib/swaram`, and explicit memory/CPU limits.

Run Alembic manually before restarting application units. Configure Nginx TLS
and proxy `/api`, `/health`, and `/ready` to port 8000 and all other requests
to port 3000. Schedule `.venv/bin/swaram-cleanup` at least hourly with a systemd
timer. Back up PostgreSQL configuration/metadata according to policy, but do
not retain the temporary private audio directory beyond the disclosed session
retention period.

Use `systemctl`, `journalctl`, `/health`, `/ready`, and
`swaram-worker --healthcheck` for verification. A deployment is not complete
until HTTPS microphone permission, upload limits, signed playback expiry,
manual deletion, scheduled cleanup, and a clean database migration have been
tested on the target host.

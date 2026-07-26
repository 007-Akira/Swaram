# PostgreSQL development

PostgreSQL 15 or newer is the only required infrastructure service. Set
`DATABASE_URL` in `.env`; the committed value is a development-only example.

## Native PostgreSQL

Create a local role and database using your operating system's PostgreSQL
administrator account:

```sql
CREATE ROLE swaram LOGIN PASSWORD 'choose-a-local-password';
CREATE DATABASE swaram OWNER swaram;
```

Update `.env` with that password, activate `.venv`, then run:

```bash
pnpm db:upgrade
pnpm db:status
```

`pnpm db:downgrade` reverses exactly one revision and can destroy schema data.
Use it only against a disposable development database.

Integration tests are opt-in and never guess a database:

```bash
TEST_DATABASE_URL=postgresql+psycopg://... .venv/bin/pytest -m integration
```

## Optional Docker convenience

Docker is not required. If it is available, PostgreSQL alone can be started
with:

```bash
docker compose --env-file .env -f infra/docker-compose.postgres.yml up -d --wait
```

Stop it without deleting data using `docker compose ... down`. Adding
`--volumes` permanently deletes the local Compose database.

# Operations runbook

All application logs are JSON events containing identifiers, status or failure
codes, and timing only. They must never include request bodies, tokens,
filenames, lyrics, audio samples, signed URL query strings, or full decoder
diagnostics.

## Monitoring

Check `/health` for process liveness and `/ready` for PostgreSQL connectivity.
Call `/ops/metrics` with `X-Operations-Token` over the private monitoring path
to retrieve queued/running/succeeded/failed job counts and expired sessions
awaiting cleanup. Alert on sustained queued growth, running jobs older than the
configured lease/model timeout, failed-job increases, nonzero expired cleanup
backlog, readiness failures, and cleanup command nonzero exits.

Responses include `X-Request-ID`; API logs contain request ID, method, path
(never query string), status, and duration. Worker logs contain job ID, attempt,
stage duration, total duration, stable failure code, and transience. Cleanup
logs provide examined/deleted/failed counts.

## Stuck jobs

1. Check worker health and queue counts.
2. Inspect `job_stage` events by job ID without retrieving user content.
3. Confirm the job lease expires and returns to `QUEUED`.
4. Restart the worker gracefully; SIGTERM lets active work finish during the
   configured grace period.
5. If repeat attempts fail, retain only the stable failure code and ask the
   user to re-upload. Never copy private audio into tickets.

## Failed storage deletion

The cleanup command rolls back database deletion when storage removal fails,
logs `retention_delete_failed`, and exits nonzero. Restore volume access and
rerun `swaram-cleanup`; deletion is idempotent. Escalate any nonzero backlog
past the disclosed retention window as a privacy incident.

## Worker restart

Send SIGTERM and wait for the active-job grace period. Verify
`swaram-worker --healthcheck`, then restart. A killed worker's expired lease is
recovered by the next worker. Ephemeral workspace mounts disappear with the
container, while the pipeline removes normally tracked partial durable output.

## Migration rollback

Stop writes and workers, take a PostgreSQL backup, inspect the specific Alembic
revision, and prefer a forward corrective migration. Use `alembic downgrade`
only when that revision's downgrade is reviewed against production data.
Restore the backup if downgrade verification fails. Application startup never
runs migrations automatically.

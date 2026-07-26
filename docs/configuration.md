# Production configuration

All secrets are supplied at runtime. Production startup rejects the development
database, non-PostgreSQL URLs, relative private storage, and non-HTTPS or
wildcard CORS origins.

## API

| Variable                       | Default               | Production meaning                              |
| ------------------------------ | --------------------- | ----------------------------------------------- |
| `APP_ENV`                      | `development`         | Set to `production` to enable strict validation |
| `DATABASE_URL`                 | local development URL | PostgreSQL SQLAlchemy URL; required             |
| `CORS_ORIGINS`                 | localhost JSON list   | Exact HTTPS frontend origins                    |
| `PRIVATE_DATA_ROOT`            | `data`                | Absolute private-volume root                    |
| `UPLOAD_MAX_BYTES`             | 104857600             | Compressed request ceiling, max 500 MiB         |
| `MAX_AUDIO_ASSETS_PER_SESSION` | 3                     | Bounds uploads and queued work                  |
| `RATE_LIMIT_REQUESTS`          | 120                   | Per-process API requests per window             |
| `RATE_LIMIT_WINDOW_SECONDS`    | 60                    | Local limiter window                            |
| `SESSION_RETENTION_HOURS`      | 24                    | Automatic expiry, maximum 168 hours             |
| `OPERATIONS_TOKEN`             | none                  | 32+ random characters for `/ops/metrics`        |

The reverse proxy must independently enforce TLS, body size, and a distributed
rate limit. The application limiter is not shared between replicas.

## Worker

| Variable                       | Default               | Meaning                                     |
| ------------------------------ | --------------------- | ------------------------------------------- |
| `DATABASE_URL`                 | local development URL | Same PostgreSQL database as API             |
| `PRIVATE_DATA_ROOT`            | `data`                | Same absolute private volume as API         |
| `WORKER_TEMP_ROOT`             | system temp           | Dedicated absolute temp mount in production |
| `WORKER_POLL_INTERVAL_SECONDS` | 2                     | Idle polling interval                       |
| `JOB_LEASE_SECONDS`            | 120                   | Lease renewed by stage progress/heartbeats  |
| `STEM_DEVICE`                  | `cpu`                 | `cpu`, `cuda`, `mps`, or `auto`             |
| `AUDIO_MAX_BYTES`              | 104857600             | Authoritative compressed input ceiling      |
| `AUDIO_MAX_DURATION_SECONDS`   | 900                   | Authoritative decoded duration ceiling      |
| `DECODED_AUDIO_MAX_BYTES`      | 209715200             | Combined normalized PCM ceiling             |
| `FFMPEG_TIMEOUT_SECONDS`       | 120                   | Per FFmpeg/FFprobe subprocess timeout       |
| `DEMUCS_TIMEOUT_SECONDS`       | 1800                  | Stem-separation timeout                     |

Jobs are claimed with PostgreSQL `FOR UPDATE SKIP LOCKED`. Progress updates
renew the lease. Expired running leases return to the queue. Transient decoder
or model timeouts retry up to three total attempts with a bounded delay;
deterministic failures are terminal and expose only a stable failure code.

## Release and storage lifecycle

Alembic migrations are never applied during API startup. Back up PostgreSQL,
run `alembic upgrade head` as a controlled release step, verify readiness, then
roll application processes. Rollback requires a reviewed revision-specific
plan; schema downgrade can lose data.

The implemented storage backend is a private local filesystem adapter with
opaque session-scoped keys. S3-compatible storage is a future scale option, not
implemented. Any future adapter must preserve ownership checks, private
buckets, short-lived signed access, encryption, deletion retries, and the same
retention policy.

Signed playback URLs expire in at most five minutes and cannot outlive the
session. Application APIs reject expired sessions immediately. Run
`swaram-cleanup` at least hourly to remove expired database rows and all private
objects; explicit UI deletion invokes the same private lifecycle immediately.

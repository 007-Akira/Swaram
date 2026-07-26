#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PG_BIN="$PROJECT_ROOT/.runtime/postgresql/usr/lib/postgresql/18/bin"
PG_DATA="$PROJECT_ROOT/.runtime/postgresql-data"
PG_LOG="$PROJECT_ROOT/.runtime/postgresql.log"
PG_SOCKET="$PROJECT_ROOT/.runtime"

if [[ ! -x "$PG_BIN/pg_ctl" || ! -f "$PG_DATA/PG_VERSION" ]]; then
  echo "Local PostgreSQL is not installed under .runtime." >&2
  exit 1
fi

case "${1:-status}" in
  start)
    if "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
      echo "PostgreSQL is already running."
    else
      "$PG_BIN/pg_ctl" \
        -D "$PG_DATA" \
        -l "$PG_LOG" \
        -o "-p 5432 -h 127.0.0.1 -k $PG_SOCKET" \
        start
    fi
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop
    ;;
  status)
    "$PG_BIN/pg_ctl" -D "$PG_DATA" status
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac

# Release checklist — 0.1.0-rc.1

## Completed in this repository

- [x] Public tree contains no tracked song, lyric, stem, or private audio file.
- [x] Development prototype/debug routes removed from the production build.
- [x] Session ownership, signed playback, expiry, deletion, cleanup, upload
      spoofing, path traversal, security headers, rate limits, and raw
      microphone non-persistence have automated regression coverage.
- [x] Node lint/typecheck/unit/build/format gates pass locally.
- [x] Python Ruff/format/mypy/unit gates pass locally.
- [x] Playwright Chromium smoke tests and serious/critical axe checks pass.
- [x] Generated tone/glide accuracy and pYIN runtime are measured and documented.
- [x] Multi-stage non-root web/API/worker artifacts and production configuration
      are committed without secrets or content.
- [x] Manual and expired-session API denial/deletion have automated coverage.

## Required before a public production release

- [ ] Build and vulnerability-scan all production images on a Docker host;
      record exact image sizes and resolve high/critical findings.
- [ ] Apply all Alembic revisions to a clean PostgreSQL 16 database and run the
      PostgreSQL integration suite. No local PostgreSQL service is available in
      the current workspace.
- [ ] Deploy the chosen configuration to staging with valid TLS and verify
      microphone permission over HTTPS.
- [ ] Process one authorized Malayalam song end-to-end with the production
      HTDemucs worker; do not commit or upload the source, lyrics, or stems.
- [ ] Complete a physical headphone practice session, generate/review a report,
      and record microphone latency, graph FPS, and five-minute clock drift.
- [ ] Verify signed playback expiry, immediate deletion, scheduled cleanup, and
      backup-retention behavior against staging storage.
- [ ] Add the missing end-user session creation/audio/lyrics upload screen or
      explicitly release this repository as an integration-only engine.
- [ ] Choose and add an explicit open-source license before describing the
      repository as open source.

This checklist is intentionally not marked complete: Docker, PostgreSQL,
staging, physical-device, and authorized-media release verification require
external infrastructure or user-controlled content that was not available in
this workspace.

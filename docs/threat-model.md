# Threat model

## Scope and assets

Swaram stores private uploaded songs, Malayalam lyrics, generated derivatives,
analysis packages, session tokens, and derived practice scores. Raw microphone
audio is processed in the browser and is not uploaded or persisted. Trust
boundaries are the browser, public API, PostgreSQL, private object directory,
and asynchronous worker subprocesses.

## Controls

- Session tokens have 256 bits of randomness, are returned once, and are stored
  only as SHA-256 hashes. Ownership failures return `404` to avoid enumeration.
- Object keys are random, single-component values scoped below a UUID session
  directory. Storage rejects absolute paths, traversal, separators, and
  cross-session access.
- Upload bodies, decoded duration, estimated decoded PCM size, number of
  original assets per session, subprocess time, and worker threads are bounded.
- FFprobe validates decoded content. The detected format must agree with both
  the filename extension and declared MIME type. FFmpeg/FFprobe protocol
  allowlists prohibit network inputs, and subprocesses use argument arrays with
  `shell=False`.
- Playback is authorized or uses a five-minute HMAC URL tied to the session,
  asset, and expiry. Responses are private/no-store and referrers are disabled.
- Lyrics and filenames are Unicode-normalized and never rendered as HTML.
  Browser and API responses set CSP, anti-framing, MIME-sniffing, referrer, and
  permissions headers.
- An in-process IP limiter provides a local abuse ceiling. Audio assets are
  capped per session, indirectly bounding analysis jobs. Expired sessions are
  removed by the idempotent cleanup command; explicit deletion removes storage
  before database records.

## Residual risks and deployment requirements

The in-memory limiter is not shared between replicas and is intentionally not
described as distributed denial-of-service protection. Production must add an
edge or gateway limiter, request-body limits, TLS, trusted-proxy configuration,
and monitoring. Phase 8.2 defines actual worker container/resource isolation;
the Python subprocess controls alone are not a sandbox.

FFmpeg, Demucs, PyTorch, and audio codecs process attacker-controlled input.
Keep their container image patched, run the worker without root, deny outbound
network after model provisioning, and treat decoder crashes as hostile.
Signed URLs can be replayed until their short expiry if leaked. Local deletion
cannot guarantee erasure from infrastructure snapshots or backups; production
backup retention must not exceed the disclosed policy.

The web CSP currently permits framework-required inline scripts/styles and
development evaluation. A nonce-based production CSP remains recommended.

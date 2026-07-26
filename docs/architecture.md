# Architecture

Swaram is a standalone monorepo with independently runnable web, API, and
worker processes.

The Next.js browser application will own real-time microphone processing. The
FastAPI service owns authenticated metadata and creates durable PostgreSQL job
records. A separate Python worker will claim those jobs transactionally using
`FOR UPDATE SKIP LOCKED`; heavy audio processing must never execute in an API
request handler.

Private user audio is stored through a typed filesystem interface under
`data/`. Runtime files are ignored by Git and must remain access-controlled,
temporary, and deletable. Separated stems are not downloadable in the MVP.

Applications and services may depend on shared packages. Shared packages must
not import application or service internals, and the worker must not import API
implementation modules.

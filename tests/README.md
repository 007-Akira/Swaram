# Cross-component tests

Integration and end-to-end tests that span component ownership belong here.
Unit tests remain next to their owning component.

## Test matrix

| Layer                   | Mandatory command             | Coverage                                                             |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------- |
| TypeScript packages/web | `pnpm test`                   | contracts, DSP, components, privacy-safe report construction         |
| Python API/worker       | `pytest -m "not integration"` | API, ownership, storage, cleanup, worker pipeline units              |
| PostgreSQL              | `pytest -m integration`       | migrations, queue leases, readiness, pipeline persistence            |
| Browser                 | `pnpm test:e2e`               | Malayalam UI, security headers, graph load, mocked microphone denial |
| Authorized audio/ML     | see below                     | real FFmpeg/HTDemucs input; never committed or uploaded              |

The first four rows are separate mandatory CI jobs. The HTDemucs check is
expensive and opt-in because it needs locally authorized media and model/GPU
resources:

```bash
RUN_AUDIO_INTEGRATION=1 \
SWARAM_AUTHORIZED_AUDIO=/absolute/private/path/input.wav \
.venv/bin/pytest services/worker/tests/test_stem_separation.py \
  -k opt_in_authorized_htdemucs_integration
```

The path must remain outside the repository. CI does not receive private songs
or lyrics. Generated-tone accuracy and performance evaluation is handled by
the Phase 8.4 harness, which is safe to automate.

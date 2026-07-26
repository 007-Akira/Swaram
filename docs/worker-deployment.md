# Worker deployment

The worker image runs as UID/GID `10001`, exposes no inbound port, and uses
`tini` as PID 1. The compose profiles mount the image root read-only, drop all
Linux capabilities, prevent privilege escalation, bound processes, CPU,
memory, and temporary disk, and attach only an internal database network.
`/data` is the shared private object volume; `/var/tmp/swaram` is the dedicated
per-container workspace and is removed with the container.

Build and run the CPU profile after setting a non-development database password:

```bash
export POSTGRES_PASSWORD='replace-with-a-secret'
docker compose -f infra/docker-compose.worker.yml --profile cpu up --build
```

The CPU profile allows 4 CPUs and 8 GiB RAM. It is portable but HTDemucs can be
slow. The GPU profile allows 4 CPUs, 12 GiB host RAM, and one NVIDIA GPU:

```bash
docker compose -f infra/docker-compose.worker.yml --profile gpu up --build
```

It requires the NVIDIA container runtime and a CUDA-compatible PyTorch image or
wheel set. The supplied slim image is a CPU baseline; validate and pin a
CUDA-specific base image before production GPU use.

The image health check runs `swaram-worker --healthcheck`, which verifies
PostgreSQL, the private storage and temp roots, and FFmpeg/FFprobe. It does not
run Demucs or consume a job. There are no HTTP health endpoints because the
worker has no inbound listener.

SIGTERM stops polling, allows an active job to finish inside the 20-minute
grace period, exits its isolated workspace context (deleting temporary files),
and disposes the database engine. An orchestrator that enforces a shorter
termination window may kill active decoder/model subprocesses before Python
cleanup completes; the ephemeral temp mount still disappears with the
container, while durable partial outputs are removed on a normal pipeline
failure.

The internal network blocks internet egress while retaining database access.
Provision model artifacts in the image during build; do not enable runtime
model downloads. If the deployment platform cannot provide equivalent network,
filesystem, and resource controls, that limitation must be recorded rather
than describing the worker as sandboxed.

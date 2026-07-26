# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS runtime

ARG INSTALL_AUDIO_ML=1
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PRIVATE_DATA_ROOT=/data \
    WORKER_TEMP_ROOT=/var/tmp/swaram \
    TORCH_HOME=/opt/swaram-model-cache

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 swaram \
    && useradd --system --uid 10001 --gid swaram --home-dir /nonexistent swaram \
    && mkdir -p /data /var/tmp/swaram /opt/swaram-model-cache \
    && chown -R swaram:swaram /data /var/tmp/swaram /opt/swaram-model-cache

WORKDIR /app
COPY packages/contracts ./packages/contracts
COPY services/worker ./services/worker
RUN python -m pip install ./packages/contracts ./services/worker \
    && if [ "$INSTALL_AUDIO_ML" = "1" ]; then \
         python -m pip install "./services/worker[audio-ml]" \
         && python -c "from demucs.pretrained import get_model; get_model('htdemucs')"; \
       fi \
    && chown -R swaram:swaram /opt/swaram-model-cache

USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["swaram-worker"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["swaram-worker", "--healthcheck"]

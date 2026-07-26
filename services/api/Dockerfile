# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS builder
ENV PIP_NO_CACHE_DIR=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /build
COPY packages/contracts ./packages/contracts
COPY services/api ./services/api
RUN python -m pip install ./packages/contracts ./services/api

FROM python:3.11-slim AS runtime
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN groupadd --system --gid 10001 swaram \
    && useradd --system --uid 10001 --gid swaram --home-dir /nonexistent swaram
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY --from=builder --chown=swaram:swaram /build/services/api ./services/api
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
CMD ["uvicorn", "swaram_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=127.0.0.1"]

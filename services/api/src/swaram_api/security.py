from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}
request_logger = logging.getLogger("swaram.api")


class InMemoryRateLimitMiddleware(BaseHTTPMiddleware):
    """Single-process abuse control; use an edge/distributed limiter in production."""

    def __init__(self, app: ASGIApp, *, requests: int, window_seconds: int) -> None:
        super().__init__(app)
        self._requests = requests
        self._window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path.startswith("/api/"):
            client = request.client.host if request.client else "unknown"
            now = time.monotonic()
            with self._lock:
                hits = self._hits[client]
                while hits and now - hits[0] >= self._window_seconds:
                    hits.popleft()
                if len(hits) >= self._requests:
                    return Response(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        headers={"Retry-After": str(self._window_seconds)},
                    )
                hits.append(now)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


class RequestObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        supplied = request.headers.get("x-request-id", "")
        request_id = (
            supplied if 0 < len(supplied) <= 128 and supplied.isascii() else uuid.uuid4().hex
        )
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            request_logger.exception(
                json.dumps(
                    {
                        "event": "api_request_failed",
                        "method": request.method,
                        "path": request.url.path,
                        "request_id": request_id,
                    },
                    sort_keys=True,
                )
            )
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        request_logger.info(
            json.dumps(
                {
                    "duration_ms": duration_ms,
                    "event": "api_request_complete",
                    "method": request.method,
                    "path": request.url.path,
                    "request_id": request_id,
                    "status": response.status_code,
                },
                sort_keys=True,
            )
        )
        return response

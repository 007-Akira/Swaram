from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details))
        super().__init__(message)


async def api_error_handler(request: Request, error: ApiError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = error.body.model_copy(
        update={"error": error.body.error.model_copy(update={"request_id": request_id})}
    )
    return JSONResponse(status_code=error.status_code, content=body.model_dump())

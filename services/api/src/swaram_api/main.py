from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from swaram_api.database import get_db_session
from swaram_api.errors import ApiError, api_error_handler
from swaram_api.jobs import router as jobs_router
from swaram_api.sessions import router as sessions_router
from swaram_api.settings import Settings, get_settings


class HealthResponse(BaseModel):
    status: str


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or get_settings()
    application = FastAPI(title="Swaram API", version="0.0.0")
    application.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    application.include_router(sessions_router)
    application.include_router(jobs_router)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @application.get("/ready", response_model=HealthResponse)
    async def ready(session: Annotated[Session, Depends(get_db_session)]) -> HealthResponse:
        try:
            session.execute(text("SELECT 1"))
        except SQLAlchemyError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "database_unavailable",
                    "message": "PostgreSQL readiness check failed",
                },
            ) from error
        return HealthResponse(status="ready")

    return application


app = create_app()

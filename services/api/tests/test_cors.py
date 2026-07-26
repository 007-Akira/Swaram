from swaram_api.main import create_app
from swaram_api.settings import Settings


def test_cors_uses_configured_origins() -> None:
    application = create_app(Settings(cors_origins=["https://practice.example"], _env_file=None))
    cors_middleware = next(
        middleware
        for middleware in application.user_middleware
        if middleware.cls.__name__ == "CORSMiddleware"
    )
    assert cors_middleware.kwargs["allow_origins"] == ["https://practice.example"]

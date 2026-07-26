from swaram_api.main import app


def test_app_has_expected_title() -> None:
    assert app.title == "Swaram API"

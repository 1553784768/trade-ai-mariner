from fastapi.testclient import TestClient

from mariner.factory import create_standalone_app as create_app
from mariner.settings import Settings


def test_health_and_errors(tmp_path):
    app = create_app(Settings(scheduler_enabled=False, database_url=f"sqlite:///{tmp_path}/test.db", as_of_date="2026-10-31"))
    @app.get("/test-validation")
    def validated(value: int):
        return value
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        assert client.get("/api/tariff/health").json() == {"status": "ok"}
        response = client.get("/test-validation?value=no")
        assert response.status_code == 400
        assert response.json() == {"error": {"code": "BAD_REQUEST", "message": "请求参数不合法"}}

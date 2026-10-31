from fastapi.testclient import TestClient

from app import create_app


def test_registration_login_me_and_logout(tmp_path):
    client = TestClient(create_app(tmp_path / "accounts.sqlite3", "test-secret"))
    payload = {"email": "a@example.com", "password": "correct-horse-1"}

    created = client.post("/api/register", json=payload)
    assert created.status_code == 201
    assert created.json() == {"id": 1, "email": "a@example.com"}
    cookie = created.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert client.get("/api/me").json() == created.json()

    assert client.post("/api/logout").json() == {"ok": True}
    assert client.get("/api/me").status_code == 401

    logged_in = client.post("/api/login", json=payload)
    assert logged_in.status_code == 200
    assert logged_in.json() == created.json()


def test_workspace_identity_requires_login_and_invalid_login_is_generic(tmp_path):
    client = TestClient(create_app(tmp_path / "accounts.sqlite3", "test-secret"))

    assert client.get("/api/me").status_code == 401
    bad = client.post(
        "/api/login",
        json={"email": "missing@example.com", "password": "wrong-password"},
    )
    assert bad.status_code == 401
    assert bad.json() == {"detail": "Invalid email or password"}


def test_duplicate_registration_returns_conflict(tmp_path):
    client = TestClient(create_app(tmp_path / "accounts.sqlite3", "test-secret"))
    payload = {"email": "a@example.com", "password": "correct-horse-1"}

    assert client.post("/api/register", json=payload).status_code == 201
    duplicate = client.post("/api/register", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "Email already registered"}


def test_invalid_registration_is_unprocessable(tmp_path):
    client = TestClient(create_app(tmp_path / "accounts.sqlite3", "test-secret"))

    response = client.post(
        "/api/register", json={"email": "bad", "password": "short"}
    )

    assert response.status_code == 422



def test_unchanged_session_does_not_overwrite_company_selection(tmp_path):
    app = create_app(tmp_path / "accounts.sqlite3", "test-secret")
    client = TestClient(app)
    client.post("/api/register", json={"email": "session@example.com", "password": "correct-horse-1"})
    client.get("/api/me")
    previous_cookie = client.cookies.get("login_demo_session")
    created = client.post("/api/companies", json={"name": "Second"})
    assert "set-cookie" in created.headers
    old_client = TestClient(app)
    old_client.cookies.set("login_demo_session", previous_cookie)
    delayed_read = old_client.get("/api/company")
    assert "set-cookie" not in delayed_read.headers
    assert client.get("/api/company").json()["id"] == created.json()["id"]
    assert "set-cookie" in client.post("/api/logout").headers

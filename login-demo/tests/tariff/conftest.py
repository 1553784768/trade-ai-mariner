import socket

import pytest
from fastapi.testclient import TestClient

from mariner.factory import create_standalone_app as create_app
from mariner.settings import Settings


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    original = socket.socket.connect
    def denied(*args, **kwargs):
        raise AssertionError("Tests must not access the network")
    def local_only(sock, address):
        if address[0] in ("127.0.0.1", "::1"):
            return original(sock, address)
        return denied()
    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(socket.socket, "connect", local_only)


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(database_url=f"sqlite:///{tmp_path}/test.db", as_of_date="2026-10-31",
                              collector_mode="fixture", scheduler_enabled=False))
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        yield client

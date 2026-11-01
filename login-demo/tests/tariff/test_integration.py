import sqlite3
import time

import httpx
import respx
from fastapi.testclient import TestClient

from app import create_app
from mariner.settings import Settings


def test_isolation_encryption_scheduler_and_origin(tmp_path):
    path = tmp_path / 'accounts.sqlite3'
    settings = Settings(collector_mode='fixture', as_of_date='2026-10-31', scheduler_enabled=False)
    app = create_app(path, 'test-secret', tariff_settings=settings)
    with TestClient(app) as a, TestClient(app) as b:
        response = a.get('/api/tariff/meta?lang=en')
        assert response.status_code == 401
        assert response.json()['error']['code'] == 'UNAUTHORIZED'
        assert a.post('/api/login', json={}, headers={'Origin': 'https://evil.example'}).status_code == 403
        for client, email in [(a, 'a@example.com'), (b, 'b@example.com')]:
            assert client.post('/api/register', json={'email': email, 'password': 'correct-horse-1'}).status_code == 201
        registry = app.state.tariff_registry
        assert registry.existing_tenants() == []
        assert len(a.get('/api/tariff/impacts').json()) == 8
        assert len(b.get('/api/tariff/impacts').json()) == 8
        assert a.post('/api/tariff/impacts/O5/decision', json={'decision': 'dismissed'}).status_code == 200
        assert b.get('/api/tariff/impacts/O5').json()['decision'] == 'pending'
        original = a.get('/api/company').json()['id']
        second = a.post('/api/companies', json={'name': 'Second company'}).json()['id']
        assert a.get('/api/tariff/impacts/O5').json()['decision'] == 'pending'
        a.post(f'/api/companies/{original}/select')
        assert a.get('/api/tariff/impacts/O5').json()['decision'] == 'dismissed'
        response = a.put('/api/tariff/settings/llm', json={'base_url': 'https://model.example/v1', 'model': 'test', 'api_key': 'private-key-1234'})
        assert response.status_code == 200, response.text
        assert response.json()['api_key_masked'] == '****1234'
        assert not b.get('/api/tariff/settings/llm').json()['configured']
        with respx.mock:
            respx.post('https://model.example/v1/chat/completions').mock(return_value=httpx.Response(200, json={'choices': [{'message': {'content': '{"ok":true}'}}]}))
            assert a.post('/api/tariff/settings/llm/test').json()['ok']
        assert a.get('/api/tariff/settings/llm').json()['last_test']['ok']
        with sqlite3.connect(path) as conn:
            row = conn.execute(
                'SELECT workspace_id,base_url,model,api_key_encrypted FROM model_settings'
            ).fetchone()
            assert 'private-key-1234' not in row[3]
            other = conn.execute('SELECT id FROM workspaces WHERE id != ?', (row[0],)).fetchone()[0]
            conn.execute(
                'INSERT INTO model_settings(workspace_id,base_url,model,api_key_encrypted) VALUES (?,?,?,?)',
                (other, row[1], row[2], row[3]),
            )
        assert not b.get('/api/tariff/settings/llm').json()['configured']
        a.delete('/api/tariff/settings/llm')
        response = a.post('/api/tariff/pipeline/runs')
        assert response.status_code == 202
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            result = a.get('/api/tariff/pipeline/runs/latest').json()
            if result['status'] != 'running':
                break
            time.sleep(.05)
        assert result['status'] in ('succeeded', 'partial')
        unopened = a.post('/api/companies', json={'name': 'Not enabled'}).json()['id']
        registry.run_scheduled()
        assert not registry.path_for(row[0], unopened).exists()
        assert registry.path_for(row[0], second).exists()

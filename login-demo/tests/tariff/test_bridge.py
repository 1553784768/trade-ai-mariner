import json

import httpx
from fastapi.testclient import TestClient

from app import create_app
from mariner.settings import Settings


def test_conversion_scope_validation_and_lifecycle(tmp_path):
    app = create_app(tmp_path / 'accounts.sqlite3', 'test', tariff_settings=Settings(
        collector_mode='fixture', as_of_date='2026-10-31', scheduler_enabled=False))
    with TestClient(app) as a, TestClient(app) as b:
        for client, name in [(a, 'a'), (b, 'b')]:
            assert client.post('/api/register', json={'email': f'{name}@example.com', 'password': 'password-test-1'}).status_code == 201
        customer = a.post('/api/customers', json={'name': 'Buyer A'}).json()
        order = a.post('/api/orders', json={'customer_id': customer['id'], 'order_no': 'TRADE-1', 'items': [
            {'product_name': 'Motor', 'quantity': 100, 'unit_price': 25},
            {'product_name': 'Toy', 'quantity': 50, 'unit_price': 40}]}).json()
        oid = order['id']
        prefix = f'/api/trade-tariff/orders/{oid}'
        assert a.get('/api/trade-tariff/status').json() == {'opened': False, 'meta': None}
        assert a.get('/api/trade-tariff/summary').json() == {'opened': False}
        assert a.get('/api/trade-tariff/links').json() == []
        assert a.get(f"/api/trade-tariff/customers/{customer['id']}/impacts").json() == []
        assert a.get(prefix + '/impacts').json() == []
        assert app.state.tariff_registry.existing_tenants() == []
        assert a.put(f'/api/orders/{oid}', json={'status': '已下单'}).status_code == 200
        draft = a.get(prefix + '/draft')
        assert draft.status_code == 200, draft.text
        data = draft.json()
        assert len(data['rows']) == 2
        assert data['rows'][0]['values']['status'] == 'confirmed'
        assert data['rows'][0]['values']['qty'] == '100'
        payload = {'rows': [{'item_position': v['item_position'], 'values': v['values']} for v in data['rows']]}
        invalid = a.post(prefix + '/convert', json=payload)
        assert invalid.status_code == 422, invalid.text
        assert invalid.json()['detail']['errors'][0]['row'] == 1
        assert len(a.get('/api/tariff/orders').json()) == 8
        sample = a.get('/api/tariff/orders').json()[0]
        for i, row in enumerate(payload['rows']):
            row['values'] = {**sample, 'order_id': f'TRADE-1-{i+1}', 'product': ['Motor', 'Toy'][i], 'hts10': ['8501.10.40', '9503.00.00'][i], 'status': 'confirmed'}
        result = a.post(prefix + '/convert', json=payload)
        assert result.status_code == 200, result.text
        assert result.json()['imported'] == 2
        again = a.post(prefix + '/convert', json=payload)
        assert again.json()['updated'] == 2, again.text
        assert len(a.get('/api/trade-tariff/links').json()) == 2
        assert all(v['impact']['risk_level'] for v in a.get(prefix + '/impacts').json())
        for suffix in ('draft', 'impacts'):
            assert b.get(prefix + '/' + suffix).status_code == 404
        assert b.post(prefix + '/convert', json=payload).status_code == 404
        collision = {'rows': [{'item_position': 0, 'values': {**sample, 'order_id': 'O1'}}]}
        assert a.post(prefix + '/convert', json=collision).status_code == 409
        assert a.put(f'/api/orders/{oid}', json={'status': '已出货'}).status_code == 200
        assert a.post(prefix + '/sync-status').json()['updated'] == 2
        assert a.post(prefix + '/sync-status').json()['updated'] == 0
        assert a.get(prefix + '/impacts').json()[0]['impact']['status'] == 'shipped'
        linked = a.put('/api/trade-tariff/links/O3', json={'customer_id': customer['id']})
        assert linked.status_code == 200, linked.text
        assert len(a.get(f"/api/trade-tariff/customers/{customer['id']}/impacts").json()) == 3
        assert b.get(f"/api/trade-tariff/customers/{customer['id']}/impacts").status_code == 404
        assert a.put('/api/trade-tariff/links/TRADE-1-1', json={'customer_id': None}).status_code == 409
        assert a.put(f'/api/orders/{oid}', json={'items': [{'product_name': 'New name'}]}).status_code == 200
        assert all(v['stale'] for v in a.get(prefix + '/impacts').json())
        assert any(v['stale'] for v in a.get(prefix + '/draft').json()['rows'])
        assert a.get('/api/trade-tariff/summary').status_code == 200
        actions = [v['action'] for v in a.get('/api/tariff/audit').json()]
        assert 'TRADE_LINK_CHANGED' in actions


def test_chat_consent_is_explicit_and_audited(tmp_path, monkeypatch):
    captured = []

    def provider(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, content='data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
                              headers={'Content-Type': 'text/event-stream'})

    app = create_app(tmp_path / 'accounts.sqlite3', 'test', model_transport=httpx.MockTransport(provider))
    with TestClient(app) as client:
        client.post('/api/register', json={'email': 'chat@example.com', 'password': 'password-test-1'})
        client.put('/api/model-settings', json={
            'base_url': 'https://model.example/v1',
            'model': 'test-model',
            'api_key': 'test-key',
        })
        cid = client.post('/api/conversations', json={'title': 'Consent test'}).json()['id']
        client.post(f'/api/conversations/{cid}/stream', json={'content': 'Hi', 'include_tariff': True})
        assert '尚未启用关税风险模块' in captured[-1]['messages'][0]['content']
        assert not app.state.tariff_registry.existing_tenants()
        client.get('/api/tariff/meta')
        client.post(f'/api/conversations/{cid}/stream', json={'content': 'Hi', 'include_tariff': False})
        assert '关税风险模块的最新结果' not in captured[-1]['messages'][0]['content']
        assert not any(v['action'] == 'CHAT_ORDER_DATA_SENT' for v in client.get('/api/tariff/audit').json())
        client.post(f'/api/conversations/{cid}/stream', json={'content': 'Hi', 'include_tariff': True})
        assert '关税风险模块的最新结果' in captured[-1]['messages'][0]['content']
        assert sum(v['action'] == 'CHAT_ORDER_DATA_SENT' for v in client.get('/api/tariff/audit').json()) == 1

        from fastapi import HTTPException
        from chat_store import ChatStore
        def busy(*args, **kwargs):
            raise HTTPException(409, 'busy')
        monkeypatch.setattr(ChatStore, 'claim_turn', busy)
        before = len(captured)
        for route in ('stream', 'hermes'):
            assert client.post(f'/api/conversations/{cid}/{route}', json={'content': 'Hi', 'include_tariff': True}).status_code == 409
        assert len(captured) == before
        assert sum(v['action'] == 'CHAT_ORDER_DATA_SENT' for v in client.get('/api/tariff/audit').json()) == 1


def test_link_failure_retry_currency_and_cancelled_order(tmp_path, monkeypatch):
    from contextlib import contextmanager
    import tariff_bridge_api as bridge
    application = create_app(tmp_path / 'accounts.sqlite3', 'test', tariff_settings=Settings(
        collector_mode='fixture', as_of_date='2026-10-31', scheduler_enabled=False))
    with TestClient(application) as client:
        client.post('/api/register', json={'email': 'retry@example.com', 'password': 'password-test-1'})
        buyer = client.post('/api/customers', json={'name': 'Buyer'}).json()
        order = client.post('/api/orders', json={'customer_id': buyer['id'], 'order_no': 'EUR-1', 'currency': 'EUR',
            'items': [{'product_name': 'Motor', 'quantity': 100, 'unit_price': 25}]}).json()
        prefix = f"/api/trade-tariff/orders/{order['id']}"
        draft = client.get(prefix + '/draft').json()
        assert draft['rows'][0]['values']['unit_price_usd'] in ('', None)
        sample = client.get('/api/tariff/orders').json()[0]
        payload = {'rows': [{'item_position': 0, 'values': {**sample, 'order_id': 'RETRY-1', 'product': 'Motor'}}]}
        original = bridge.connection
        @contextmanager
        def failing_connection(path):
            with original(path) as conn:
                class Proxy:
                    def execute(self, sql, *args):
                        if 'INSERT INTO tariff_order_links' in sql:
                            raise OSError('Simulated link persistence failure')
                        return conn.execute(sql, *args)
                yield Proxy()
        with monkeypatch.context() as patch:
            patch.setattr(bridge, 'connection', failing_connection)
            response = client.post(prefix + '/convert', json=payload)
            assert response.status_code == 500
        assert client.get('/api/trade-tariff/links').json() == []
        retry = client.post(prefix + '/convert', json=payload)
        assert retry.status_code == 200, retry.text
        assert retry.json()['updated'] == 1
        assert len(client.get('/api/trade-tariff/links').json()) == 1
        client.put(f"/api/orders/{order['id']}", json={'status': '已取消'})
        assert client.get(prefix + '/draft').status_code == 409
        assert client.post(prefix + '/convert', json=payload).status_code == 409
        assert client.post(prefix + '/sync-status').status_code == 409

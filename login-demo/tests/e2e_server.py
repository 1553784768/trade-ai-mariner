"""Disposable, offline browser server for the integrated application."""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import tempfile

os.environ['TARIFF_COLLECTOR_MODE'] = 'fixture'
os.environ['TARIFF_AS_OF_DATE'] = '2026-10-31'
os.environ['TARIFF_SCHEDULER_ENABLED'] = 'false'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
import uvicorn
from fastapi import APIRouter

from app import create_app
from auth import register_user
from business import WorkspaceStore
from chat_store import ChatStore
from database import connection
from tenancy import TenantContext
from browser_fixture import ReasoningStream, hermes_streamer


async def research_stub(target):
    return dict(overall_rating='medium', overall_score=55, layers={'whois': {'domain': target}, 'mx': {'valid': True}},
                flags=['示例风险标记'], recommendations=['核对公司注册信息'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8019)
    parser.add_argument('--web', type=Path, default=Path(__file__).resolve().parents[1] / 'web/out')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='trade-bridge-e2e-') as folder:
        path = Path(folder) / 'accounts.sqlite3'
        helper = APIRouter()
        captured = {}

        @helper.get('/api/__e2e/last-model-request')
        def last_request():
            return captured

        def model(request):
            if request.url.host == 'api.tavily.com':
                return httpx.Response(200, json={'answer': '公开资料显示客户采购工业水泵。', 'results': [
                    {'title': 'Acme official site', 'url': 'https://acme.example/about', 'content': 'Industrial pumps.', 'score': .9}]})
            captured.clear()
            captured.update(json.loads(request.content))
            return httpx.Response(200, stream=ReasoningStream(), headers={'content-type': 'text/event-stream'})

        application = create_app(path, 'e2e-secret', model_transport=httpx.MockTransport(model),
                                 osint_runner=research_stub, hermes_streamer=hermes_streamer,
                                 web_dir=args.web.resolve(), extra_routers=[helper])
        for email in ('e2e@example.com', 'e2e-other@example.com'):
            user = register_user(path, email, 'e2e-password-1')
            with connection(path) as conn:
                wid = conn.execute('SELECT id FROM workspaces WHERE owner_user_id=?', (user['id'],)).fetchone()[0]
                company = conn.execute('SELECT id FROM companies WHERE workspace_id=?', (wid,)).fetchone()[0]
            tenant = TenantContext(user['id'], wid, email, company)
            store = WorkspaceStore(path, tenant)
            store.update_company({'name': 'Trade AI Demo', 'products': 'Industrial motors and toys'})
            if email == 'e2e@example.com':
                for name, country, tier, category, buyer_type in [
                    ('Acme GmbH', '德国', 'A', '打火机', '连锁超市'),
                    ('Globex LLC', '美国', 'B', '打火机', '打火机批发商'),
                    ('Pajama World', '法国', 'C', '睡衣', '睡衣零售商'),
                ]:
                    store.create_customer({
                        'name': name,
                        'country': country,
                        'tier': tier,
                        'main_category': category,
                        'buyer_type': buyer_type,
                        'email': 'buyer@example.com',
                    })
                ChatStore(path, tenant).save_settings({
                    'provider': 'openai-compatible',
                    'base_url': 'https://model.example/v1',
                    'model': 'fixture-model',
                    'api_key_encrypted': application.state.secret_store.encrypt(wid, 'fake-e2e-key'),
                })
                with connection(path) as conn:
                    conn.execute('INSERT INTO research_settings(workspace_id,api_key_encrypted) VALUES (?,?)',
                                 (wid, application.state.secret_store.encrypt(wid, 'fake-tavily-key')))
        original = socket.socket.connect

        def local_only(sock, address):
            if address[0] not in ('127.0.0.1', '::1', 'localhost'):
                raise OSError('E2E cannot access external services')
            return original(sock, address)

        socket.socket.connect = local_only
        uvicorn.run(application, host='127.0.0.1', port=args.port, log_level='warning')


if __name__ == '__main__':
    main()

import json

import httpx

from mariner.settings import PROMPTS
from mariner.api.routes import session_dep
from mariner.db import models as m


def test_tokens_preserve_first_occurrence_across_languages():
    from mariner.knowledge.service import tokens
    assert tokens('机器人 IEEPA 机器人 tariff-301 你好 today') == ['机器', '器人', 'ieepa', 'tariff-301']


def test_write_visibility_before_dependency_cleanup(client):
    factory = client.app.state.factory
    def uncommitted_dependency():
        with factory() as session:
            yield session
            # No commit here: a response must already be durable.
    client.app.dependency_overrides[session_dep] = uncommitted_dependency
    for _ in range(100):
        response = client.post('/api/tariff/chat/conversations')
        assert response.status_code == 200
        cid = response.json()['id']
        with factory() as session:
            assert session.get(m.ChatConversation, cid)
        assert client.post(f'/api/tariff/chat/conversations/{cid}/messages', json={'text': '你好'}).status_code == 200
    for i in range(50):
        decision = 'dismissed' if i % 2 else 'needs_detail'
        response = client.post('/api/tariff/impacts/O5/decision', json={'decision': decision, 'note': 'visibility'})
        assert response.status_code == 200
        assert client.get('/api/tariff/impacts/O5').json()['decision'] == decision


def test_retrieval_fixture_contract(client):
    from mariner.knowledge.service import retrieve
    client.app.state.pipeline.start(background=False)
    base = ['brief:2026-10-31', 'watch:W_301_EXCLUSION_EXPIRY', 'watch:W_232_ROBOTICS', 'watch:W_301_EXCESS_CAPACITY']
    with client.app.state.factory() as session:
        def ids(q, previous='', enabled=False):
            return [v['id'] for v in retrieve(session, q, previous, enabled, ['O5'], settings=client.app.state.settings)]
        assert ids('今日政策变化') == [base[0], 'policy:2026-20510', *base[1:]]
        for q in ['你好', '今天有哪些需要关注的政策？', 'What changed today?']:
            assert ids(q) == base
        for q, first in [('机器人关税有变化吗', 'policy:2026-22385'), ('邮政小包有什么新规定', 'policy:2026-21600'), ('IEEPA 退款怎么办', 'policy:2026-20228')]:
            assert ids(q)[0] == first
        assert ids('那它什么时候到期？', '301排除的情况')[0] == base[1]
        assert ids('O5 为什么是红色？', enabled=True)[:2] == ['impact:O5', 'order:O5']


def test_context_history_prompt_and_failure(client, respx_mock, monkeypatch):
    from mariner.api import chat
    from mariner.agents.llm_client import HttpLLMClient
    monkeypatch.setattr(chat, 'HttpLLMClient', lambda config: HttpLLMClient(config, sleep=lambda _: None))
    client.app.state.pipeline.start(background=False)
    cid = client.post('/api/tariff/chat/conversations').json()['id']
    for _ in range(4):
        client.post(f'/api/tariff/chat/conversations/{cid}/messages', json={'text': '你好'})
    client.put('/api/tariff/settings/llm', json={'base_url': 'https://model.example/v1', 'model': 'demo', 'api_key': 'secret'})
    route = respx_mock.post('https://model.example/v1/chat/completions').respond(json={'choices': [{'message': {'content': '{"answer":"Hello","citations":[]}'}}]})
    response = client.post(f'/api/tariff/chat/conversations/{cid}/messages', json={'text': 'O5 为什么是红色？'})
    assert response.status_code == 200
    request = json.loads(route.calls.last.request.content)
    payload = json.loads(request['messages'][1]['content'])
    assert payload['as_of'] == '2026-10-31'
    assert payload['order_data_enabled'] is False and payload['mentioned_orders'] == ['O5']
    assert len(payload['history']) == 6 and all(set(m) == {'role', 'text'} for m in payload['history'])
    assert (PROMPTS/'chat_v2.md').read_text('utf-8').strip() in request['messages'][0]['content']
    assert not chat.unknown_numbers('37', '', [], [{'text': '37', 'role': 'user'}])
    route.mock(side_effect=httpx.ConnectError('offline'))
    response = client.post(f'/api/tariff/chat/conversations/{cid}/messages', json={'text': '今日政策变化'})
    assert response.status_code == 200
    pair = response.json()
    assert pair['assistant']['error'] and pair['assistant']['text'] == '无法连接模型服务'
    assert client.get(f'/api/tariff/chat/conversations/{cid}').json()['messages'][-2:] == [pair['user'], pair['assistant']]
    response = client.post(f'/api/tariff/chat/conversations/{cid}/messages', json={'text': 'Hello', 'lang': 'en'})
    assert response.json()['assistant']['text'] == 'Cannot reach the model service'


def test_conversation_listing_deletion_preserves_import(client):
    from mariner.db.store import rows
    a, b = [client.post('/api/tariff/chat/conversations').json()['id'] for _ in range(2)]
    assert client.get('/api/tariff/chat/conversations?lang=en').json()[0]['title'] == 'New chat'
    for cid, text in [(a, '你好'), (b, 'x' * 35), (a, '今日政策变化')]:
        client.post(f'/api/tariff/chat/conversations/{cid}/messages', json={'text': text})
    values = client.get('/api/tariff/chat/conversations').json()
    assert [v['id'] for v in values] == [a, b]
    assert values[0]['title'] == '你好' and values[0]['message_count'] == 4
    assert values[1]['title'] == 'x' * 30
    assert client.get('/api/tariff/chat/conversations/latest').json()['id'] == b
    with client.app.state.factory.begin() as session:
        session.add(m.ImportJob(id='preserved', business_date='2026-10-31', payload={'conversation_id': a}))
    assert client.delete(f'/api/tariff/chat/conversations/{a}').json() == {'deleted': True}
    assert client.get(f'/api/tariff/chat/conversations/{a}').status_code == 404
    assert len(client.get('/api/tariff/chat/conversations').json()) == 1
    with client.app.state.factory() as session:
        assert not any(row.conversation_id == a for row in rows(session, m.ChatMessage))
        assert session.get(m.ImportJob, 'preserved')
    assert any(v['action'] == 'CHAT_DELETED' for v in client.get('/api/tariff/audit').json())

def test_knowledge_soft_delete_sync_and_restore(client):
    client.app.state.pipeline.start(background=False)
    key = 'policy:2026-21755'
    assert client.delete('/api/tariff/kb/' + key).json() == {'deleted': True}
    assert key not in [v['id'] for v in client.get('/api/tariff/kb').json()]
    assert key in [v['id'] for v in client.get('/api/tariff/kb?deleted=true').json()]
    assert key not in [v['id'] for v in client.get('/api/tariff/kb', params={'q': 'USTR 海事'}).json()]
    client.app.state.pipeline.start(background=False)
    deleted = client.get('/api/tariff/kb/' + key).json()
    assert deleted['deleted'] and deleted['deleted_at']
    # Restoration must refresh unedited language content from the current source.
    with client.app.state.factory.begin() as session:
        row = session.get(m.KbEntry, key)
        row.payload = {**row.payload, 'body_en': 'stale'}
    restored = client.post('/api/tariff/kb/' + key + '/undelete').json()
    assert not restored['deleted'] and restored['deleted_at'] is None
    assert restored['body_en'] == restored['auto_body_en'] != 'stale'
    assert key in [v['id'] for v in client.get('/api/tariff/kb').json()]
    before = client.get('/api/tariff/impacts/O5').json()
    assert client.delete('/api/tariff/kb/impact:O5').status_code == 200
    assert client.get('/api/tariff/impacts/O5').json() == before
    from mariner.knowledge.service import retrieve
    with client.app.state.factory() as session:
        assert 'impact:O5' not in [v['id'] for v in retrieve(session, 'O5', include_sensitive=True, order_ids=['O5'])]
    assert any(v['action'] == 'KB_UNDELETED' for v in client.get('/api/tariff/audit').json())

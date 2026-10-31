import json

import httpx
import pytest

from mariner.audit.service import audit_hash
from mariner.engine.i18n import parse
from mariner.engine.service import carry_over_decisions
from mariner.settings import ROOT, PROMPTS


def pipeline(client):
    client.app.state.pipeline.start(background=False)


def test_decision_validation_and_carry(client):
    for body in [{"decision": "adopted", "action_indices": indices} for indices in ([], [4], [0, 0])] + [
        {"decision": "needs_detail"}, {"decision": "needs_detail", "note": "  "}
    ]:
        assert client.post('/api/tariff/impacts/O5/decision', json=body).status_code == 400
    result = client.post('/api/tariff/impacts/O5/decision', json={"decision": "adopted", "action_indices": [0, 2]})
    assert result.status_code == 200, result.text
    detail = client.get('/api/tariff/impacts/O5').json()
    assert [a['index'] for a in detail['adopted_actions']] == [0, 2]
    assert detail['seller_cost_delta_usd'] == 16000
    assert detail['margin_delta_pp'] == -17.78
    assert any(e['summary'] == 'O5 · 已采纳 · 第 01、03 条' for e in client.get('/api/tariff/audit').json())
    client.post('/api/tariff/runs')
    assert client.get('/api/tariff/impacts/O5').json()['decision'] == 'adopted'
    old = dict(profit_delta_usd=1, risk_level='红', decision='adopted', adopted_actions=[dict(text='A')])
    assert carry_over_decisions(old, dict(profit_delta_usd=1, risk_level='红', actions=['A'])) == 'adopted'
    assert carry_over_decisions(old, dict(profit_delta_usd=1, risk_level='红', actions=['B'])) == 'pending'


def test_knowledge_sync_edit_restore_and_privacy(client):
    assert len(client.get('/api/tariff/kb?include_sensitive=true').json()) == 23
    pipeline(client)
    assert len(client.get('/api/tariff/kb?include_sensitive=true').json()) == 32
    result = client.get('/api/tariff/kb', params={'q': '301 排除'}).json()
    assert 'watch:W_301_EXCLUSION_EXPIRY' in [v['id'] for v in result]
    assert not any(v['sensitive'] for v in result)
    key = 'policy:2026-20511'
    original = client.get('/api/tariff/kb/'+key).json()
    assert client.put('/api/tariff/kb/'+key, json=dict(lang='zh', title=original['title_zh'], body='Local edit')).status_code == 200
    client.post('/api/tariff/rule-drafts/DRAFT-2026-20511/review', json={'action':'approve'})
    changed = client.get('/api/tariff/kb/'+key).json()
    assert changed['source_changed'] and changed['body_zh'] == 'Local edit'
    restored = client.post('/api/tariff/kb/'+key+'/restore', json={'lang':'zh'}).json()
    assert not restored['source_changed'] and restored['body_zh'] == restored['auto_body_zh']
    assert client.put('/api/tariff/kb/impact:O5', json=dict(lang='zh', title='x', body='x')).status_code == 409
    manual = client.post('/api/tariff/kb', json=dict(title_zh='Test', body_zh='Body')).json()
    assert client.put('/api/tariff/kb/'+manual['id'], json=dict(lang='en', title='Test EN', body='Body EN')).status_code == 200
    assert client.delete('/api/tariff/kb/'+manual['id']).status_code == 200
    actions = {e['action'] for e in client.get('/api/tariff/audit?limit=200').json()}
    assert {'KB_CREATED','KB_EDITED','KB_DELETED','KB_RESTORED'} <= actions


def test_chat_guard_and_import(client):
    pipeline(client)
    cid = client.post('/api/tariff/chat/conversations').json()['id']
    path = '/api/tariff/chat/conversations/'+cid+'/messages'
    policy = client.post(path, json=dict(text='今天有哪些需要关注的政策？')).json()['assistant']
    assert len(policy['citations']) == 2 and policy['guard']['ok']
    off = client.post(path, json=dict(text='O5 为什么是红色？')).json()['assistant']
    assert off['guard'] == dict(ok=False, unknown_numbers=['2026-11-16','41.9','16,000.00','8,473.57','7,526.43'])
    assert 'impact:O5' not in [v['id'] for v in off['citations']]
    on = client.post(path, json=dict(text='O5 为什么是红色？', use_order_data=True)).json()['assistant']
    assert on['guard']['ok']
    image = ROOT/'backend/fixtures/import/order_sheet_sample.png'
    job = client.post('/api/tariff/import-jobs', data=dict(conversation_id=cid), files={'file':(image.name,image.read_bytes(),'image/png')}).json()['job']
    assert job['status'] == 'needs_consent' and job['requires_model']
    path = '/api/tariff/import-jobs/'+job['id']
    parsed = client.post(path+'/consent').json()
    assert parsed['status'] == 'parsed' and len(parsed['rows']) == 2 and not parsed['errors'], parsed
    rows = parsed['rows']
    original = rows[0]['qty']
    rows[0]['qty'] = '0'
    assert len(client.put(path+'/rows', json=dict(rows=rows)).json()['errors']) == 1
    assert client.post(path+'/commit').status_code == 422
    rows[0]['qty'] = original
    client.put(path+'/rows', json=dict(rows=rows))
    assert client.post(path+'/commit').json()['imported'] == 2
    counts = client.get('/api/tariff/meta').json()['counts']
    assert counts['pending'] == 10 and counts['green'] == 6
    actions = {v['action'] for v in client.get('/api/tariff/audit?limit=200').json()}
    assert {'CHAT_ORDER_DATA_SENT','IMPORT_SENT_TO_MODEL','ORDERS_IMPORTED','RUN_CREATED'} <= actions
    csv = ROOT/'seed/engine/orders_sample.csv'
    job = client.post('/api/tariff/import-jobs', data=dict(conversation_id=cid), files={'file':(csv.name,csv.read_bytes())}).json()['job']
    assert job['status'] == 'parsed' and not job['requires_model'] and len(job['rows']) == 8
    assert client.post('/api/tariff/import-jobs/'+job['id']+'/commit').json()['updated'] == 8


def test_english_and_template_roundtrip(client):
    golden = json.loads((ROOT/'seed/golden/impacts.json').read_text('utf-8'))
    for value in golden['impacts'] if isinstance(golden, dict) and 'impacts' in golden else golden:
        if isinstance(value, str):
            value = golden[value]
        for kind, texts in [('actions',value['actions']),('flags',value['flags']),('reasons',value['risk_reasons'].split('；'))]:
            for text in filter(None,texts):
                matches = parse(text,kind)
                assert len(matches) == 1, text
                template, params = matches[0]
                assert template['zh'].format(**params) == text
    english = client.get('/api/tariff/impacts/O5?lang=en').json()
    assert english['actions'][0].startswith('If entry happens on or before 2026-11-09, the rate is 16.9% (currently 41.9%)')
    assert english['risk_reasons'] == 'Loss after recalculation'
    assert english['layers'][1]['label'] == 'Section 301 list'
    pipeline(client)
    assert client.get('/api/tariff/briefs/latest?lang=en').json()['conclusion'].startswith('There is no new rate change in force today.')
    for event in client.get('/api/tariff/audit?limit=200').json():
        assert event['summary_zh'] and event['summary_en']
        assert audit_hash(event) == event['hash']


@pytest.mark.parametrize('response,expected', [
    (httpx.ConnectError('no route'),'无法连接模型服务'),
    (httpx.ReadTimeout('slow'),'模型请求超时'),
    (httpx.Response(401,text='denied'),'HTTP 401：denied'),
    (httpx.Response(200,text='html'),'模型返回内容不是符合要求的 JSON'),
    (httpx.Response(200,json={'choices':[{'message':{'content':'{"ok": false}'}}]}),'模型已响应，但返回内容不是 {"ok": true}')
])
def test_connection_errors(client, respx_mock, response, expected):
    client.put('/api/tariff/settings/llm', json=dict(base_url='https://model.example/v1', model='demo', api_key='secret'))
    route = respx_mock.post('https://model.example/v1/chat/completions')
    if isinstance(response, Exception):
        route.mock(side_effect=response)
    else:
        route.mock(return_value=response)
    assert client.post('/api/tariff/settings/llm/test').json()['message'] == expected

@pytest.mark.parametrize('response,expected', [
    (httpx.ConnectError('no route'), '无法连接模型服务'),
    (httpx.ReadTimeout('slow'), '模型请求超时'),
    (httpx.Response(401, text='denied'), 'HTTP 401：denied'),
    (httpx.Response(200, text='html'), '模型返回内容不是符合要求的 JSON'),
])
def test_pipeline_errors_surface(client, respx_mock, monkeypatch, response, expected):
    from mariner.agents.llm_client import HttpLLMClient
    from mariner.pipeline import orchestrator
    monkeypatch.setattr(orchestrator, 'HttpLLMClient', lambda config: HttpLLMClient(config, sleep=lambda _: None))
    client.put('/api/tariff/settings/llm', json=dict(base_url='https://model.example/v1', model='demo', api_key='secret'))
    route = respx_mock.post('https://model.example/v1/chat/completions')
    route.mock(**({'side_effect': response} if isinstance(response, Exception) else {'return_value': response}))
    pipeline(client)
    run = client.get('/api/tariff/pipeline/runs/latest').json()
    step = next(s for s in run['steps'] if s['agent'] == 'triage')
    assert step['counts']['errors'] == 30
    assert step['message'] == expected
    en = client.get('/api/tariff/pipeline/runs/latest?lang=en').json()
    assert next(s for s in en['steps'] if s['agent'] == 'triage')['message'] != expected


def test_multimodal_and_v2_prompts(respx_mock):
    import base64
    from pydantic import BaseModel
    from mariner.agents.llm_client import HttpLLMClient
    class Result(BaseModel):
        ok: bool
    route = respx_mock.post('https://model.example/v1/chat/completions').respond(json={'choices': [{'message': {'content': '{"ok":true}'}}]})
    image = (ROOT/'backend/fixtures/import/order_sheet_sample.png').read_bytes()
    client = HttpLLMClient(dict(base_url='https://model.example/v1', model='demo', api_key='secret'))
    client.complete_json(system='test', user='image', schema=Result, fixture_key='', role='import', images=[image])
    blocks = json.loads(route.calls.last.request.content)['messages'][1]['content']
    assert blocks[0] == {'type': 'text', 'text': 'image'}
    assert blocks[1]['image_url']['url'] == 'data:image/png;base64,'+base64.b64encode(image).decode()
    for role, field in [('triage', 'one_line_en'), ('extract', 'summary_en')]:
        prompt = (PROMPTS/f'{role}_v2.md').read_text('utf-8')
        client.complete_json(system=prompt, user='test', schema=Result, fixture_key='', role=role)
        assert field in json.loads(route.calls.last.request.content)['messages'][0]['content']


def test_validation_edge_cases_and_zero_red_brief(client):
    from copy import deepcopy
    from mariner.agents.validate import validate
    from mariner.agents.brief import build_brief
    from mariner.db import models as m
    from mariner.db.store import build_snapshot
    from mariner.engine.adapter import current_impacts
    pipeline(client)
    with client.app.state.factory.begin() as session:
        snapshot = build_snapshot(session)
        _, impacts = current_impacts(session, client.app.state.settings)
        draft = deepcopy(session.get(m.RuleDraft, 'DRAFT-2026-20511').payload)
        program = snapshot['programs'][0]
        draft['change'] = dict(change_type='program_add', target_id=program['id'], payload=program)
        result = validate(draft, draft['source_text'], '2026-10-31', snapshot, client.app.state.settings, impacts)
        assert next(v for v in result['validation'] if v['check'] == 'V8')['status'] == 'fail'
        draft['change'] = dict(change_type='watch_item_upsert', target_id='', payload={})
        result = validate(draft, draft['source_text'], '2026-10-31', snapshot, client.app.state.settings, impacts)
        assert next(v for v in result['validation'] if v['check'] == 'V2')['status'] == 'fail'
    client.post('/api/tariff/impacts/O5/decision', json=dict(decision='dismissed'))
    with client.app.state.factory.begin() as session:
        brief = build_brief(session, client.app.state.settings)
        assert brief['conclusion'].endswith('没有待处理的红色订单。')
    triage = json.loads((ROOT/'backend/fixtures/llm/triage.json').read_text('utf-8'))
    extract = json.loads((ROOT/'backend/fixtures/llm/extract.json').read_text('utf-8'))
    kb = client.get('/api/tariff/kb/policy:2026-20511').json()
    assert kb['title_en'] == triage['2026-20511']['one_line_en']
    assert extract['2026-20511']['summary_en'] in kb['body_en']
    brief = client.get('/api/tariff/briefs/latest?lang=en').json()
    assert any(i['title'] == kb['title_en'] and i['summary'] == extract['2026-20511']['summary_en'] for i in brief['items'])


def test_chat_live_privacy_and_retry(client, respx_mock):
    pipeline(client)
    client.put('/api/tariff/settings/llm', json=dict(base_url='https://model.example/v1', model='demo', api_key='secret'))
    cid = client.post('/api/tariff/chat/conversations').json()['id']
    def reply(answer, citations):
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(dict(answer=answer, citations=citations))}}]})
    route = respx_mock.post('https://model.example/v1/chat/completions').mock(side_effect=[reply('Unverified 999999999', ['impact:O5']), reply('No verified number.', ['impact:O5'])])
    result = client.post('/api/tariff/chat/conversations/'+cid+'/messages', json=dict(text='O5 为什么是红色？')).json()['assistant']
    assert route.call_count == 2 and result['guard']['ok'] and not result['citations']
    context = json.loads(json.loads(route.calls[0].request.content)['messages'][1]['content'])['context']
    assert not any(v['id'].startswith(('impact:', 'order:')) for v in context)
    assert not any(e['action'] == 'CHAT_ORDER_DATA_SENT' for e in client.get('/api/tariff/audit?limit=200').json())
    route.mock(return_value=reply('No verified number.', ['impact:O5']))
    result = client.post('/api/tariff/chat/conversations/'+cid+'/messages', json=dict(text='O5 为什么是红色？', use_order_data=True)).json()['assistant']
    assert result['citations'][0]['id'] == 'impact:O5'
    assert any(e['action'] == 'CHAT_ORDER_DATA_SENT' for e in client.get('/api/tariff/audit?limit=200').json())


def test_xlsx_local_parse_cancel_and_cleared_bytes(client):
    import csv
    import io
    import openpyxl
    from mariner.db import models as m
    rows = list(csv.reader((ROOT/'seed/engine/orders_sample.csv').read_text('utf-8-sig').splitlines()))
    book = openpyxl.Workbook()
    for row in rows:
        book.active.append(row)
    content = io.BytesIO()
    book.save(content)
    cid = client.post('/api/tariff/chat/conversations').json()['id']
    job = client.post('/api/tariff/import-jobs', data=dict(conversation_id=cid), files={'file': ('orders.xlsx', content.getvalue())}).json()['job']
    assert job['status'] == 'parsed' and not job['requires_model'] and len(job['rows']) == 8
    assert not job['errors']
    assert client.post('/api/tariff/import-jobs/'+job['id']+'/cancel').json()['status'] == 'cancelled'
    assert client.post('/api/tariff/import-jobs/'+job['id']+'/commit').status_code == 409
    with client.app.state.factory() as session:
        assert session.get(m.ImportJob, job['id']).content is None


def test_english_errors_and_xlsx_limit(client):
    import csv
    import io
    import openpyxl
    cid = client.post('/api/tariff/chat/conversations').json()['id']
    assert client.get('/api/tariff/kb/missing?lang=en').json()['error']['message'] == 'Knowledge entry not found: missing'
    data = list(csv.reader((ROOT/'seed/engine/orders_sample.csv').read_text('utf-8-sig').splitlines()))
    book = openpyxl.Workbook()
    book.active.append(data[0])
    for i in range(201):
        row = data[1].copy()
        row[0] = f'TEST-{i}'
        book.active.append(row)
        book.active.append([None] * len(row))
    content = io.BytesIO()
    book.save(content)
    result = client.post('/api/tariff/import-jobs?lang=en', data=dict(conversation_id=cid), files={'file': ('large.xlsx', content.getvalue())}).json()
    assert result['messages'][0]['text'] == 'Uploaded file: large.xlsx'
    assert result['messages'][1]['text'] == 'Recognizing…'
    job = result['job']
    assert job['errors'] == [dict(row=201, field='file', message='Invalid request parameters')]
    assert client.post('/api/tariff/import-jobs/'+job['id']+'/commit').status_code == 422
    row = dict(zip(data[0], data[1]))
    row['qty'] = '0'
    path = '/api/tariff/import-jobs/'+job['id']+'/rows'
    changed = client.put(path+'?lang=en', json=dict(rows=[row])).json()
    assert changed['errors'][0]['message'] == 'qty must be greater than 0'
    failed = client.post('/api/tariff/import-jobs/'+job['id']+'/commit?lang=en').json()['error']
    assert failed['details'][0]['message'] == 'qty must be greater than 0'

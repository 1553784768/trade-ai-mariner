from fastapi.testclient import TestClient
from app import create_app


def test_export_routes_and_cache_policy(tmp_path):
    root = tmp_path / 'out'
    (root / 'tariff').mkdir(parents=True)
    (root / '_next/static').mkdir(parents=True)
    for name, content in [('index.html', 'home'), ('login.html', 'login'), ('tariff/inbox.html', 'inbox'),
                          ('404.html', 'missing'), ('disabled.html', 'NEXT_HTTP_ERROR_FALLBACK;404'), ('_next/static/test.js', 'script')]:
        (root / name).write_text(content)
    client = TestClient(create_app(tmp_path / 'accounts.sqlite3', 'test', web_dir=root))
    assert client.get('/').text == 'home'
    assert client.get('/login').text == 'login'
    assert client.get('/tariff/inbox').text == 'inbox'
    assert client.get('/tariff/inbox').headers['cache-control'] == 'no-store'
    assert 'immutable' in client.get('/_next/static/test.js').headers['cache-control']
    assert client.get('/api/absent').status_code == 404
    assert client.get('/absent').status_code == 404
    assert client.get('/disabled').status_code == 404
    assert client.get('/trade', follow_redirects=False).headers['location'] == '/'
    assert client.get('/%2e%2e/accounts.sqlite3').status_code == 404


def test_unbuilt_export_returns_actionable_503(tmp_path):
    client = TestClient(create_app(tmp_path / 'accounts.sqlite3', 'test', web_dir=tmp_path / 'missing'))
    assert client.get('/').status_code == 503
    assert 'build:export' in client.get('/').text

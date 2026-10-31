"""Avoid stale read responses overwriting a newly selected company cookie."""
from copy import deepcopy
from starlette.middleware.sessions import SessionMiddleware


class StableSessionMiddleware(SessionMiddleware):
    def __init__(self, app, **kwargs):
        async def snapshot(scope, receive, send):
            scope['_session_before_request'] = deepcopy(scope.get('session', {}))
            await app(scope, receive, send)
        super().__init__(snapshot, **kwargs)

    async def __call__(self, scope, receive, send):
        async def stable_send(message):
            if (message['type'] == 'http.response.start'
                    and scope.get('_session_before_request') == scope.get('session')):
                prefix = (self.session_cookie + '=').encode()
                message['headers'] = [(key, value) for key, value in message.get('headers', [])
                                      if not (key.lower() == b'set-cookie' and value.startswith(prefix))]
            await send(message)
        await super().__call__(scope, receive, stable_send)

import json
import base64
import time
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from mariner.collectors.service import read_fixture


class NoFixture(Exception):
    pass


class LLMClient(Protocol):
    def complete_json(self, *, system: str, user: str, schema: type[BaseModel], fixture_key: str,
                      role: Literal["triage", "extract", "chat", "import"], images: list[bytes] | None = None) -> BaseModel: ...


class FixtureLLMClient:
    model = "fixture"
    usage = {}

    def complete_json(self, *, system, user, schema, fixture_key, role, images=None):
        value = read_fixture(f"llm/{role}.json").get(fixture_key)
        if value is None:
            raise NoFixture(fixture_key)
        return schema.model_validate(value)


class HttpLLMClient:
    def __init__(self, config, sleep=time.sleep):
        self.config, self.sleep = config, sleep
        self.model, self.usage = config["model"], {}

    def complete_json(self, *, system, user, schema, fixture_key, role, images=None):
        url = self.config["base_url"].rstrip("/") + "/chat/completions"
        headers = {"Authorization": f'Bearer {self.config["api_key"]}', "Content-Type": "application/json"}
        system += "\n\nJSON schema:\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False)
        correction_used = transport_used = False
        while True:
            content = user if not images else [{"type": "text", "text": user}, *[
                {"type": "image_url", "image_url": {"url": f"data:image/{'jpeg' if data[:3] == bytes.fromhex('ffd8ff') else 'png'};base64," + base64.b64encode(data).decode()}}
                for data in images]]
            try:
                response = httpx.post(url, headers=headers, timeout=120, json={"model": self.model,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                    "response_format": {"type": "json_object"}})
                if response.status_code >= 500:
                    response.raise_for_status()
                if response.status_code >= 400:
                    raise ValueError(f"HTTP {response.status_code}：{response.text.replace(self.config['api_key'], '****')[:200]}")
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                if transport_used:
                    message = ("模型请求超时" if isinstance(exc, httpx.TimeoutException) else
                               f"HTTP {exc.response.status_code}：{exc.response.text.replace(self.config['api_key'], '****')[:200]}"
                               if isinstance(exc, httpx.HTTPStatusError) else "无法连接模型服务")
                    raise ValueError(message) from None
                transport_used = True
                self.sleep(2)
                continue
            try:
                body = response.json()
                self.usage = body.get("usage", {})
                content = json.loads(body["choices"][0]["message"]["content"])
                return schema.model_validate(content)
            except (ValueError, KeyError, IndexError, TypeError, ValidationError) as exc:
                if correction_used:
                    raise ValueError("模型返回内容不是符合要求的 JSON") from None
                correction_used = True
                user += f"\n上次输出不符合要求：{str(exc)[:500]}。只返回符合要求的 JSON。"

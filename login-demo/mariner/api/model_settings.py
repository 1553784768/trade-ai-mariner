import time
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from pydantic import RootModel

from mariner.agents.llm_client import HttpLLMClient
from mariner.api import schemas as s
from mariner.api.errors import ApiException
from mariner.api.routes import session_dep, settings_dep, llm_dep
from mariner.audit.service import append
from mariner.settings import now
from mariner.localization import translate

router = APIRouter(prefix="/settings/llm")


def public_settings(record, lang="zh"):
    if not record:
        return dict(configured=False, base_url=None, model=None, api_key_masked=None, last_test=None)
    value = record
    last_test = value.get("last_test")
    if last_test and lang == "en":
        last_test = {**last_test, "message": translate(last_test["message"])}
    return dict(configured=True, base_url=value["base_url"], model=value["model"],
                api_key_masked="****" + value["api_key"][-4:], last_test=last_test)


@router.get("", response_model=s.LlmSettings)
def get_settings(lang: Literal["zh", "en"] = "zh", session=Depends(session_dep), llm=Depends(llm_dep)):
    return public_settings(llm.get(), lang)


@router.put("", response_model=s.LlmSettings)
def save_settings(body: s.LlmSettingsRequest, session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    record = llm.get()
    key = body.api_key if body.api_key is not None else record["api_key"] if record else None
    parsed = urlparse(body.base_url)
    if not key or not body.model.strip() or parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    record = llm.save(base_url=body.base_url.rstrip("/"), model=body.model, api_key=key)
    append(session, str(settings.today), "LLM_SETTINGS_CHANGED", "本地用户", "llm_settings", f"模型配置已保存：{body.model}")
    session.commit()
    return public_settings(record)


@router.delete("", response_model=s.LlmSettings)
def clear_settings(session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    llm.clear()
    append(session, str(settings.today), "LLM_SETTINGS_CHANGED", "本地用户", "llm_settings", "模型配置已清除")
    session.commit()
    return public_settings(None)


@router.post("/test", response_model=s.TestConnection)
def test_settings(lang: Literal["zh", "en"] = "zh", session=Depends(session_dep), llm=Depends(llm_dep)):
    record = llm.get()
    if record is None:
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    class Ping(RootModel[object]):
        pass
    start = time.monotonic()
    try:
        result = HttpLLMClient(record).complete_json(system='Reply with the JSON object {"ok": true}.',
                 user="ping", schema=Ping, fixture_key="", role="triage")
        ok = result.root == {"ok": True} and isinstance(result.root.get("ok"), bool)
        message = "连接成功" if ok else '模型已响应，但返回内容不是 {"ok": true}'
    except (ValueError, KeyError) as exc:
        ok, message = False, str(exc)
    latency = round((time.monotonic() - start) * 1000, 2)
    value = dict(ok=ok, message=message, latency_ms=latency)
    llm.record_test({**value, "at": now()})
    session.commit()
    return {**value, "message": translate(message) if lang == "en" else message}

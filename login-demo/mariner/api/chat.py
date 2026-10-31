import json
import re
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from mariner.agents.llm_client import HttpLLMClient
from mariner.api.errors import ApiException
from mariner.api.routes import missing, session_dep, settings_dep, llm_dep
from mariner.audit.service import append
from mariner.collectors.service import read_fixture
from mariner.db import models as m
from mariner.db.store import rows
from mariner.knowledge.service import mentioned_orders, retrieve
from mariner.settings import PROMPTS, now

router = APIRouter(prefix="/chat/conversations")


class MessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=24000)
    lang: Literal["zh", "en"] = "zh"
    use_order_data: bool = False


class ChatResult(BaseModel):
    answer: str
    citations: list[str]


def conversation(session, key):
    record = session.get(m.ChatConversation, key)
    if not record:
        missing("对话", key)
    return record


def message(session, settings, cid, role, text, citations=None, guard=None, import_job_id=None, error=False):
    value = dict(id=uuid4().hex, role=role, text=text, citations=citations or [], guard=guard,
                 import_job_id=import_job_id, error=error, created_at=now())
    session.add(m.ChatMessage(id=value["id"], business_date=str(settings.today), payload=value, conversation_id=cid))
    return value


@router.post("")
def create(session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    key = uuid4().hex
    session.add(m.ChatConversation(id=key, business_date=str(settings.today), payload=dict(id=key, created_at=now())))
    session.commit()
    return {"id": key}


def messages(session, key):
    return [{"error": False, **r.payload} for r in sorted(rows(session, m.ChatMessage), key=lambda r: r.payload["created_at"]) if r.conversation_id == key]


@router.get("")
def listing(limit: int = Query(50, ge=1, le=200), lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    result = []
    for record in rows(session, m.ChatConversation):
        history = messages(session, record.id)
        first = next((v["text"] for v in history if v["role"] == "user"), "新对话" if lang == "zh" else "New chat")
        result.append(dict(id=record.id, title=first[:30], created_at=record.payload["created_at"],
                           updated_at=history[-1]["created_at"] if history else record.payload["created_at"], message_count=len(history)))
    return sorted(result, key=lambda v: v["updated_at"], reverse=True)[:limit]


@router.get("/latest")
def latest(session=Depends(session_dep)):
    values = rows(session, m.ChatConversation)
    if not values:
        missing("对话", "latest")
    record = max(values, key=lambda r: r.payload["created_at"])
    return {**record.payload, "messages": messages(session, record.id)}


@router.get("/{key}")
def detail(key: str, session=Depends(session_dep)):
    return {**conversation(session, key).payload, "messages": messages(session, key)}


@router.delete("/{key}")
def delete(key: str, session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    record = conversation(session, key)
    for row in rows(session, m.ChatMessage):
        if row.conversation_id == key:
            session.delete(row)
    session.delete(record)
    append(session, str(settings.today), "CHAT_DELETED", "本地用户", key, f"{key} · 删除对话")
    session.commit()
    return {"deleted": True}


def unknown_numbers(answer, question, context, history=()):
    source = question + "\n" + "\n".join(v["title"] + "\n" + v["body"] for v in context) + "\n" + "\n".join(v["text"] for v in history)
    return list(dict.fromkeys(n for n in re.findall(r"\d+(?:[.,:\-]\d+)*", answer) if n not in source))


@router.post("/{key}/messages")
def send(key: str, body: MessageRequest, session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    conversation(session, key)
    if not body.text.strip():
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法")
    config = llm.get()
    fixture = read_fixture("llm/chat.json").get(body.text.strip().lower()) if not config else None
    previous = messages(session, key)
    history = [{"role": v["role"], "text": v["text"]} for v in previous[-6:]]
    prev_question = next((v["text"] for v in reversed(previous) if v["role"] == "user"), "")
    order_ids = [o.id for o in rows(session, m.Order)]
    mentioned = mentioned_orders(body.text, order_ids)
    candidates = []
    if fixture:
        candidates = [e.payload for cid in fixture["citations"] if (e := session.get(m.KbEntry, cid)) and not e.payload.get("deleted", False) and (body.use_order_data or not e.payload["sensitive"])]
    elif config:
        candidates = retrieve(session, body.text, prev_question, body.use_order_data, order_ids, settings=settings)
    context, seen, length = [], set(), 0
    sensitive = []
    for v in candidates:
        if v["id"] in seen or len(context) == 8:
            continue
        title, text = v["title_"+body.lang], v["body_"+body.lang]
        size = len(v["id"]) + len(title) + len(text) + 5
        if length + size > 24000:
            break
        context.append(dict(id=v["id"], title=title, body=text))
        seen.add(v["id"])
        length += size
        if v["sensitive"]:
            sensitive.append(v["id"])
    if sensitive:
        model = config["model"] if config else "内置夹具"
        append(session, str(settings.today), "CHAT_ORDER_DATA_SENT", "本地用户", key, f'对话向模型 {model} 发送订单数据：{", ".join(sensitive)}')
        # Persist consent evidence even if the external request fails.
    failed = False
    if config:
        client = HttpLLMClient(config)
        user = json.dumps(dict(question=body.text, lang=body.lang, context=context, as_of=str(settings.today), order_data_enabled=body.use_order_data, mentioned_orders=mentioned, history=history), ensure_ascii=False)
        system = (PROMPTS / "chat_v2.md").read_text(encoding="utf-8")
        try:
            result = client.complete_json(system=system, user=user, schema=ChatResult, fixture_key="", role="chat").model_dump()
            unknown = unknown_numbers(result["answer"], body.text, context, history)
            if unknown:
                user += f'\n回答中出现了上下文里没有的数字：{", ".join(unknown)}。只能使用上下文中的数字。'
                result = client.complete_json(system=system, user=user, schema=ChatResult, fixture_key="", role="chat").model_dump()
        except ValueError as exc:
            from mariner.localization import translate
            failed = True
            result = dict(answer=translate(str(exc)) if body.lang == "en" else str(exc), citations=[])
    elif fixture:
        result = fixture
    else:
        result = dict(answer="未配置模型，且没有该问题的内置答案。请先到「模型接入」页配置模型。" if body.lang == "zh" else "No model is configured and this question has no built-in answer. Configure a model on Model Access first.", citations=[])
    unknown = unknown_numbers(result["answer"], body.text, context, history)
    citations = [dict(id=v["id"], title=v["title"]) for v in context if v["id"] in result["citations"]]
    value = dict(user=message(session, settings, key, "user", body.text),
                assistant=message(session, settings, key, "assistant", result["answer"], citations, None if failed else dict(ok=not unknown, unknown_numbers=unknown), error=failed))
    session.commit()
    return value

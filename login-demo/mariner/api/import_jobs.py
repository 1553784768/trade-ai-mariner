import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Literal
from copy import deepcopy
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field, field_validator

from mariner.agents.llm_client import HttpLLMClient
from mariner.api.chat import conversation, message
from mariner.api.errors import ApiException
from mariner.api.imports import parse_orders
from mariner.api.routes import missing, session_dep, settings_dep, llm_dep
from mariner.api.schemas import Order
from mariner.audit.service import append
from mariner.collectors.service import read_fixture
from mariner.db import models as m
from mariner.db.store import build_snapshot
from mariner.engine.service import create_run
from mariner.settings import PROMPTS, now

router = APIRouter(prefix="/import-jobs")


class Rows(BaseModel):
    rows: list[dict[str, str]] = Field(min_length=1, max_length=200)

    @field_validator("rows", mode="before")
    @classmethod
    def stringify(cls, value):
        return [{str(k): "" if v is None else str(v) for k, v in row.items()} for row in value]


class ImportResult(Rows):
    notes_zh: str
    notes_en: str


def csv_bytes(records):
    out = io.StringIO()
    writer = csv.DictWriter(out, list(Order.model_fields), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(records)
    return out.getvalue().encode("utf-8-sig")


def validate_rows(records, session, kind):
    if not records:
        return [dict(row=1, field="file", message="请求参数不合法")]
    try:
        parse_orders(csv_bytes(records), build_snapshot(session))
        return []
    except ApiException as exc:
        errors = exc.details or []
        return [{**e, "row": e["row"] - (kind != "csv")} for e in errors]


def get_job(session, key):
    record = session.get(m.ImportJob, key)
    if not record:
        missing("导入任务", key)
    return record


def localized_job(value, lang):
    from mariner.localization import translate
    result = deepcopy(value)
    if lang == "en":
        result["errors"] = [{**e, "message": translate(e["message"])} for e in result["errors"]]
    return result


def mutable(record, statuses):
    if record.payload["status"] not in statuses:
        raise ApiException(409, "CONFLICT", "请求参数不合法")


def table_rows(table):
    if not table:
        return None
    headers = [str(v).strip() for v in table[0]]
    if not set(Order.model_fields).issubset(headers):
        return None
    return [{key: "" if v is None else str(v) for key, v in zip(headers, row)}
            for row in table[1:] if any(v is not None and str(v).strip() for v in row)]


def workbook(content, max_rows=None):
    import openpyxl
    book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        source = book.worksheets[0].iter_rows(values_only=True, max_row=max_rows)
        if max_rows is not None:
            return list(source)
        table = []
        for row in source:
            if not table or any(v is not None and str(v).strip() for v in row):
                table.append(row)
            # Keep one extra data row so oversized imports fail instead of being truncated.
            if len(table) == 202:
                break
        return table
    finally:
        book.close()


@router.post("")
def create(file: UploadFile = File(...), conversation_id: str = Form(...),
           lang: Literal["zh", "en"] = "zh",
           session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    conversation(session, conversation_id)
    content = file.file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise ApiException(413, "FILE_TOO_LARGE", "文件过大（上限 10 MB）")
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    kind = {".csv": "csv", ".xlsx": "xlsx", ".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image"}.get(ext)
    if not kind:
        raise ApiException(415, "UNSUPPORTED_FILE", "不支持的文件类型")
    records, errors = None, []
    try:
        if kind == "csv":
            reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
            records = [{str(k): "" if v is None else str(v) for k, v in row.items() if k is not None} for row in reader]
            try:
                parse_orders(content, build_snapshot(session))
            except ApiException as exc:
                errors = exc.details or [dict(row=1, field="file", message=exc.message)]
        elif kind == "xlsx":
            records = table_rows(workbook(content))
        elif kind == "pdf":
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    for table in page.extract_tables():
                        records = table_rows(table)
                        if records is not None:
                            break
                    if records is not None:
                        break
    except Exception:
        if kind == "csv":
            records, errors = [], [dict(row=1, field="file", message="请求参数不合法")]
    requires_model = records is None
    records = records or []
    if len(records) > 200:
        errors = [dict(row=201, field="file", message="请求参数不合法")]
    elif not errors and not requires_model:
        errors = validate_rows(records, session, kind)
    config = llm.get()
    fixture = read_fixture("llm/import.json").get(hashlib.sha256(content).hexdigest())
    status = "needs_consent" if requires_model else "parsed"
    reply = "需要确认后发送给模型" if requires_model else "正在识别…"
    if requires_model and not config and not fixture:
        status, reply = "failed", "未配置模型，无法识别该文件。可改用 CSV 模板导入。"
    key = uuid4().hex
    value = dict(id=key, filename=filename, kind=kind, status=status, requires_model=requires_model, created_at=now(),
                 rows=records, errors=errors, model=config["model"] if config else "内置夹具" if requires_model else None,
                 notes_zh=None, notes_en=None)
    session.add(m.ImportJob(id=key, business_date=str(settings.today), payload=value, content=content))
    from mariner.localization import translate
    upload_text = f"上传文件：{filename}"
    if lang == "en":
        upload_text, reply = translate(upload_text), translate(reply)
    response = dict(job=localized_job(value, lang), messages=[message(session, settings, conversation_id, "user", upload_text),
                message(session, settings, conversation_id, "assistant", reply, import_job_id=key)])
    session.commit()
    return response


@router.get("/{key}")
def detail(key: str, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    return localized_job(get_job(session, key).payload, lang)


@router.post("/{key}/consent")
def consent(key: str, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    record = get_job(session, key)
    mutable(record, ("needs_consent",))
    v = dict(record.payload)
    config = llm.get()
    model = config["model"] if config else "内置夹具"
    append(session, str(settings.today), "IMPORT_SENT_TO_MODEL", "本地用户", key, f'文件 {v["filename"]} 已发送给模型 {model}')
    try:
        if config:
            images, user = None, ""
            if v["kind"] == "image":
                images = [record.content]
            elif v["kind"] == "xlsx":
                out = io.StringIO()
                csv.writer(out).writerows(workbook(record.content, max_rows=200))
                user = out.getvalue()
            else:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(record.content)) as pdf:
                    user = "\n".join(page.extract_text() or "" for page in pdf.pages)[:20000]
                    if not user.strip():
                        images = []
                        for page in pdf.pages[:3]:
                            out = io.BytesIO()
                            page.to_image(resolution=150).original.save(out, format="PNG")
                            images.append(out.getvalue())
            user = json.dumps({"fields": list(Order.model_fields), "text": user}, ensure_ascii=False)
            result = HttpLLMClient(config).complete_json(system=(PROMPTS / "import_v1.md").read_text(encoding="utf-8"),
                user=user, schema=ImportResult, fixture_key="", role="import", images=images).model_dump()
        else:
            result = ImportResult.model_validate(read_fixture("llm/import.json")[hashlib.sha256(record.content).hexdigest()]).model_dump()
        v.update(status="parsed", rows=result["rows"], notes_zh=result["notes_zh"], notes_en=result["notes_en"], model=model,
                 errors=validate_rows(result["rows"], session, v["kind"]))
    except Exception as exc:
        from mariner.localization import translate
        v.update(status="failed", notes_zh=str(exc), notes_en=translate(str(exc)))
    record.payload = v
    session.commit()
    return localized_job(v, lang)


@router.put("/{key}/rows")
def edit(key: str, body: Rows, lang: Literal["zh", "en"] = "zh", session=Depends(session_dep)):
    record = get_job(session, key)
    mutable(record, ("parsed",))
    record.payload = {**record.payload, "rows": body.rows, "errors": validate_rows(body.rows, session, record.payload["kind"])}
    session.commit()
    return localized_job(record.payload, lang)


@router.post("/{key}/commit")
def commit(key: str, session=Depends(session_dep), settings=Depends(settings_dep), llm=Depends(llm_dep)):
    record = get_job(session, key)
    mutable(record, ("parsed",))
    errors = validate_rows(record.payload["rows"], session, record.payload["kind"])
    if errors or record.payload["errors"]:
        raise ApiException(422, "VALIDATION_FAILED", "文件未导入，请修正以下错误", errors or record.payload["errors"])
    parsed = parse_orders(csv_bytes(record.payload["rows"]), build_snapshot(session))
    imported = updated = 0
    for value in parsed:
        old = session.get(m.Order, value["order_id"])
        if old:
            old.payload = value
            updated += 1
        else:
            session.add(m.Order(id=value["order_id"], business_date=str(settings.today), payload=value))
            imported += 1
    append(session, str(settings.today), "ORDERS_IMPORTED", "本地用户", key, f'对话导入 {record.payload["filename"]}：导入 {imported} 行，更新 {updated} 行')
    session.flush()
    run = create_run(session, settings)
    record.payload = {**record.payload, "status": "imported"}
    record.content = None
    session.commit()
    return dict(imported=imported, updated=updated, run_id=run.id, errors=[])


@router.post("/{key}/cancel")
def cancel(key: str, session=Depends(session_dep)):
    record = get_job(session, key)
    mutable(record, ("needs_consent", "parsed", "failed"))
    record.payload = {**record.payload, "status": "cancelled"}
    record.content = None
    session.commit()
    return record.payload

import csv
import io
import math
import re
from datetime import date
from typing import get_args

from mariner.api.errors import ApiException
from mariner.api.schemas import Order
from mariner.db.store import NUMERIC_FIELDS


def parse_orders(content, snapshot):
    try:
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        headers, records = reader.fieldnames or [], list(reader)
    except (UnicodeDecodeError, csv.Error):
        raise ApiException(400, "BAD_REQUEST", "请求参数不合法") from None
    errors, seen = [], set()
    def error(row, field, message):
        errors.append(dict(row=row, field=field, message=message))
    for key in Order.model_fields:
        if key not in headers:
            error(1, key, f"缺少列 {key}")
    if errors:
        raise ApiException(422, "VALIDATION_FAILED", "文件未导入，请修正以下错误", errors)
    for row, record in enumerate(records, 2):
        for field, spec in Order.model_fields.items():
            allowed = get_args(spec.annotation)
            if allowed and record[field] not in allowed:
                error(row, field, f"取值不合法：{record[field]}，允许：{', '.join(allowed)}")
        for field in NUMERIC_FIELDS:
            try:
                value = float(record[field])
                if not math.isfinite(value):
                    raise ValueError()
                record[field] = value
            except (TypeError, ValueError):
                error(row, field, f"{field} 必须是数字")
                continue
            positive = field in ("qty", "unit_price_usd", "purchase_cost_cny_per_unit", "fx_cny_per_usd", "customs_value_usd")
            condition = "大于 0" if positive else "不小于 0"
            valid = value > 0 if positive else value >= 0
            if field == "baseline_duty_rate_pct":
                condition, valid = "在 0 到 200 之间", 0 <= value <= 200
            elif field == "target_margin_pct":
                condition, valid = "在 0 到 100 之间（不含 100）", 0 <= value < 100
            if not valid:
                error(row, field, f"{field} 必须{condition}")
        dates = []
        for field in ("quote_date", "load_date", "entry_date", "delivery_date"):
            try:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", record[field] or ""):
                    raise ValueError()
                dates.append(date.fromisoformat(record[field]))
            except (TypeError, ValueError):
                error(row, field, "日期格式应为 YYYY-MM-DD")
        if len(dates) == 4 and dates != sorted(dates):
            error(row, "entry_date", "日期顺序应为 quote_date ≤ load_date ≤ entry_date ≤ delivery_date")
        clause = record["tariff_clause"] or ""
        if clause != "none":
            try:
                assert clause.startswith("share:") and 0 <= float(clause[6:]) <= 1
            except (ValueError, AssertionError):
                error(row, "tariff_clause", f"取值不合法：{clause}，允许：none, share:x（0 ≤ x ≤ 1）")
        if record["order_id"] in seen:
            error(row, "order_id", f'订单号重复：{record["order_id"]}')
        seen.add(record["order_id"])
        if record["hts10"] not in snapshot["hts_profiles"]:
            error(row, "hts10", "规则库中没有该税号，目前支持：" + ", ".join(snapshot["hts_profiles"]))
    if errors:
        raise ApiException(422, "VALIDATION_FAILED", "文件未导入，请修正以下错误", errors)
    return [{key: record[key] for key in Order.model_fields} for record in records]

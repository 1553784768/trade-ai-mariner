import re
from copy import deepcopy

from mariner.db.store import build_snapshot
from mariner.engine.i18n import render

TEXT = {
    "登录已过期，请重新登录。": "Session expired. Please sign in again.",
    "无法连接模型服务": "Cannot reach the model service",
    "模型请求超时": "Model request timed out",
    "模型返回内容不是符合要求的 JSON": "The model did not return the required JSON",
    '模型已响应，但返回内容不是 {"ok": true}': 'The model responded, but did not return {"ok": true}',
    "请求参数不合法": "Invalid request parameters", "服务器内部错误": "Internal server error",
    "请求来源不被允许": "Request origin is not allowed", "连接成功": "Connected",
    "系统生成的条目不能编辑": "System-generated entries cannot be edited",
    "系统生成的条目不能删除": "System-generated entries cannot be deleted",
    "文件过大（上限 10 MB）": "File too large (10 MB limit)", "不支持的文件类型": "Unsupported file type",
    "文件未导入，请修正以下错误": "File was not imported. Correct the errors below",
    "该草稿已处理，不能重复操作": "This draft has already been reviewed",
    "该草稿存在未通过的校验，不能确认": "This draft has failed checks and cannot be approved",
    "已有流水线正在运行": "A pipeline is already running",
    "通过": "Pass", "注意": "Attention", "不通过": "Fail", "不适用": "Not applicable",
    "无夹具，未核验": "No fixture; not verified",
    "日期格式应为 YYYY-MM-DD": "Date format must be YYYY-MM-DD",
    "日期顺序应为 quote_date ≤ load_date ≤ entry_date ≤ delivery_date": "Dates must follow quote_date ≤ load_date ≤ entry_date ≤ delivery_date",
    "正在识别…": "Recognizing…",
    "需要确认后发送给模型": "Confirmation required before sending to the model",
    "未配置模型，无法识别该文件。可改用 CSV 模板导入。": "No model configured. This file cannot be recognized. Use the CSV template instead.",
}
ERROR_TEMPLATES = [
    ("上传文件：{filename}", "Uploaded file: {filename}"),
    ("缺少列 {field}", "Missing column {field}"),
    ("{field} 必须是数字", "{field} must be a number"),
    ("{field} 必须大于 0", "{field} must be greater than 0"),
    ("{field} 必须不小于 0", "{field} must be at least 0"),
    ("{field} 必须在 0 到 200 之间", "{field} must be between 0 and 200"),
    ("{field} 必须在 0 到 100 之间（不含 100）", "{field} must be at least 0 and less than 100"),
    ("取值不合法：{value}，允许：{allowed}", "Invalid value: {value}. Allowed: {allowed}"),
    ("订单号重复：{id}", "Duplicate order ID: {id}"),
    ("规则库中没有该税号，目前支持：{codes}", "HTS code not in the rule library. Supported: {codes}"),
    ("未找到{resource}：{key}", "{resource} not found: {key}"),
]
RESOURCES_EN = {
    "知识条目": "Knowledge entry", "对话": "Conversation", "导入任务": "Import job",
    "订单": "Order", "影响单": "Impact sheet", "计算批次": "Calculation run",
    "规则草稿": "Rule draft", "草稿": "Rule draft", "日报": "Brief", "流水线批次": "Pipeline run", "流水线": "Pipeline",
}
AUDIT_TEMPLATES = [
    ("{id} · 关联客户：{name}", "{id} · Customer: {name}"),
    ("{id} · 取消关联客户", "{id} · Customer link removed"),
    ("从订单 {order} 生成：导入 {a} 行，更新 {b} 行", "Generated from order {order}: imported {a} rows, updated {b} rows"),
    ("从订单 {order} 同步状态：更新 {n} 行", "Status synced from order {order}: updated {n} rows"),
    ("Trade AI 对话 {cid} 向模型 {model} 发送订单数据：{ids}", "Trade AI chat {cid} sent order data to model {model}: {ids}"),
    ("导入 {a} 行，更新 {b} 行", "Imported {a} rows, updated {b} rows"),
    ("对话导入 {name}：导入 {a} 行，更新 {b} 行", "Chat import {name}: imported {a} rows, updated {b} rows"),
    ("批次 {run} · as_of {date}", "Run {run} · as_of {date}"),
    ("新增 {n} 篇", "Added {n} documents"),
    ("分诊 {n} 篇，相关 {r} 篇，无夹具跳过 {s} 篇", "Triaged {n} documents, {r} relevant, {s} skipped without fixtures"),
    ("生成草稿 {n} 篇，无夹具跳过 {s} 篇", "Created {n} drafts, {s} skipped without fixtures"),
    ("校验草稿 {n} 篇，存在不通过项 {f} 篇", "Checked {n} drafts, {f} with failed checks"),
    ("日报 {date} · {n} 条", "Brief {date} · {n} items"),
    ("{id} · 已采纳 · 第 {list} 条", "{id} · Adopted · Actions {list}"),
    ("{id} · 需补充 · 补充：{note}", "{id} · Needs Detail · Detail note: {note}"),
    ("{id} · 不处理", "{id} · Dismissed"),
    ("{id} · 编辑知识", "{id} · Knowledge edited"),
    ("{id} · 恢复知识", "{id} · Knowledge restored"),
    ("{id} · 新建知识", "{id} · Knowledge created"),
    ("{id} · 删除对话", "{id} · Delete chat"),
    ("{id} · 恢复删除", "{id} · Restore knowledge"),
    ("{id} · 删除知识", "{id} · Knowledge deleted"),
    ("对话向模型 {model} 发送订单数据：{ids}", "Chat sent order data to model {model}: {ids}"),
    ("文件 {name} 已发送给模型 {model}", "File {name} sent to model {model}"),
    ("模型配置已保存：{model}", "Model settings saved: {model}"),
    ("模型配置已清除", "Model settings cleared"),
    ("确认 {id} · {outcome}", "Approved {id} · {outcome}"),
    ("驳回 {id}", "Rejected {id}"),
    ("{id} 需补充", "{id} needs detail"),
]


def translate(text):
    if text in TEXT:
        return TEXT[text]
    if text.startswith("HTTP "):
        return text.replace("：", ": ", 1)
    for zh, en in ERROR_TEMPLATES:
        pattern = re.escape(zh)
        for name in re.findall(r"\{(\w+)\}", zh):
            pattern = pattern.replace(re.escape("{" + name + "}"), f"(?P<{name}>.*?)")
        match = re.fullmatch(pattern, text)
        if match:
            params = match.groupdict()
            if "resource" in params:
                params["resource"] = RESOURCES_EN.get(params["resource"], params["resource"])
            return en.format(**params)
    return text


def audit_en(summary):
    for zh, en in AUDIT_TEMPLATES:
        pattern = re.escape(zh)
        for name in re.findall(r"\{(\w+)\}", zh):
            pattern = pattern.replace(re.escape("{" + name + "}"), f"(?P<{name}>.+?)")
        match = re.fullmatch(pattern, summary)
        if match:
            params = {k: v.replace("内置夹具", "Built-in fixtures").replace("不影响现有订单", "No effect on current orders").replace("更新观察项", "Watch item updated").replace("、", ", ") for k, v in match.groupdict().items()}
            return en.format(**params)
    return translate(summary)


def localize(value, kind, lang, session):
    v = deepcopy(value)
    if lang != "en":
        return v
    if kind == "brief":
        v["conclusion"] = v.get("conclusion_en", v["conclusion"])
        for i in v["items"]:
            i["title"] = i.get("title_en") or i["title"]
            i["summary"] = i.get("summary_en") or i["summary"]
    elif kind == "draft":
        v["title"] = v.get("title_en") or v["title"]
        v["summary_zh"] = v.get("summary_en") or v["summary_zh"]
        for check in v.get("validation", []):
            check["message"] = translate(check["message"])
    elif kind == "decision":
        v["adopted_actions"] = [{**a, "text": render(a["text"], "actions", lang, session, build_snapshot(session))} for a in v.get("adopted_actions", [])]
    elif kind == "pipeline":
        for step in v["steps"]:
            if step.get("message"):
                step["message"] = translate(step["message"])
    return v

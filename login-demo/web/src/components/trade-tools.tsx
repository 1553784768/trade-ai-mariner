"use client";
import Link from "next/link";
import { useState } from "react";
import { t } from "@/i18n/runtime";
import { tradeApi, jsonBody } from "@/lib/api";
import type {
  Automation,
  AutomationRun,
  CustomerPage,
  ResearchReport,
  Skill,
  TradeConversation,
} from "@/lib/trade-types";
import { CONTEXTS } from "@/lib/trade-contexts";
import { Shell } from "./shell";
import { useTradeChatStates } from "./trade-chat";
import { Tag } from "./ui";
import {
  Field,
  Modal,
  ListDetail,
  SelectCard,
  QueryState,
  Blank,
  Markdown,
  useAction,
  useTradeQuery,
  useSelection,
} from "./trade-ui";

export function Research() {
  const reports = useTradeQuery<ResearchReport[]>("/research/reports"),
    customers = useTradeQuery<CustomerPage>("/customers?limit=100"),
    [id, setId] = useSelection(),
    action = useAction();
  const selected = id || String(reports.data?.[0]?.id || ""),
    detail = useTradeQuery<ResearchReport>(`/research/reports/${selected}`, !!selected);
  const [kind, setKind] = useState("search"),
    [target, setTarget] = useState(""),
    [customer, setCustomer] = useState("");
  const report = detail.data;
  return (
    <Shell title={t("客户背调")}>
      <section className="card conversion-card">
        <form
          className="trade-form"
          onSubmit={(e) => {
            e.preventDefault();
            const payload = {
              ...(kind === "search" ? { query: target } : { target }),
              ...(customer ? { customer_id: Number(customer) } : {}),
            };
            void action.run(
              () => tradeApi<ResearchReport>(`/research/${kind}`, jsonBody("POST", payload)),
              "背调已完成",
              (v) => setId(v.id),
            );
          }}
        >
          <div className="toolbar">
            <select
              className="select"
              aria-label={t("背调类型")}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="search">{t("搜索公开信息")}</option>
              <option value="deep">{t("深度背调")}</option>
            </select>
            <select
              className="select"
              aria-label={t("关联客户")}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            >
              <option value="">{t("不关联")}</option>
              {customers.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label={t("选择客户邮箱")}
              value=""
              onChange={(e) => {
                const [cid, ...email] = e.target.value.split(":");
                setCustomer(cid);
                setTarget(email.join(":"));
              }}
            >
              <option value="">{t("选择客户邮箱")}</option>
              {customers.data?.items.flatMap((c) =>
                [c.email, c.backup_email].filter(Boolean).map((email) => (
                  <option key={`${c.id}:${email}`} value={`${c.id}:${email}`}>
                    {c.name} · {email}
                  </option>
                )),
              )}
            </select>
          </div>
          <Field label={kind === "search" ? "搜索词" : "邮箱或域名"}>
            <input
              className="input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              minLength={2}
              maxLength={kind === "search" ? 2000 : 500}
              required
            />
          </Field>
          <div className="toolbar">
            <button className="btn btn-primary" disabled={action.busy}>
              {action.busy && <span className="spinner" />}
              {t(kind === "search" ? "搜索公开信息" : "深度背调")}
            </button>
            <Link href="/settings?tab=search">{t("搜索配置")}</Link>
          </div>
        </form>
      </section>
      <QueryState query={reports} />
      <ListDetail
        list={reports.data?.map((v) => (
          <SelectCard
            key={v.id}
            title={v.query}
            active={String(v.id) === selected}
            onClick={() => setId(v.id)}
          >
            <Tag>{t(v.status)}</Tag>
            <span>{v.customer_name}</span>
          </SelectCard>
        ))}
      >
        {report ? (
          <>
            <h2>{report.query}</h2>
            <div className="toolbar">
              <Tag tone={report.status === "error" ? "bad" : ""}>{t(report.status)}</Tag>
              <button
                className="btn"
                onClick={() => {
                  if (confirm(t("确定删除这份报告？")))
                    void action.run(
                      () => tradeApi(`/research/reports/${report.id}`, jsonBody("DELETE")),
                      "报告已删除",
                      () => setId(""),
                    );
                }}
              >
                {t("删除报告")}
              </button>
            </div>
            {report.error && <div className="banner bad">{report.error}</div>}
            <Markdown text={report.answer} />
            {!!report.details?.flags?.length && (
              <>
                <h3>{t("风险标记")}</h3>
                <ul>
                  {report.details.flags.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </>
            )}
            {report.details?.recommendations?.length && (
              <>
                <h3>{t("建议")}</h3>
                <ul>
                  {report.details.recommendations.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </>
            )}
            {report.details?.layers && (
              <>
                <h3>{t("检测层")}</h3>
                {Object.entries(report.details.layers).map(([key, value]) => (
                  <details className="thinking" key={key}>
                    <summary>{key}</summary>
                    <pre>{JSON.stringify(value, null, 2)}</pre>
                  </details>
                ))}
              </>
            )}
            <h3>{t("来源")}</h3>
            {report.sources?.map((v) => (
              <p key={v.url}>
                <a href={v.url} target="_blank" rel="noreferrer">
                  {v.title || v.url}
                </a>
                {v.content && <span className="field-help"> · {v.content}</span>}
              </p>
            ))}
          </>
        ) : selected ? (
          <QueryState query={detail} />
        ) : (
          <Blank />
        )}
      </ListDetail>
    </Shell>
  );
}
const taskTemplates = [
  {
    name: "每日早安简报",
    prompt: "生成今天的早安简报，整理需要处理的客户、订单和跟进事项。",
    skill_id: "b2b-daily-automation",
  },
  { name: "客户跟进提醒", prompt: "检查需要跟进的客户，给出下一步建议。", skill_id: "b2b-sales-pipeline" },
  { name: "社媒内容计划", prompt: "生成本周社媒内容日历。", skill_id: "b2b-social-media" },
  { name: "市场情报汇总", prompt: "整理目标市场的行业动态和客户开发机会。", skill_id: "b2b-lead-generation" },
];
function TaskEditor({
  task,
  onClose,
  onSaved,
}: {
  task?: Partial<Automation>;
  onClose: () => void;
  onSaved: (v: Automation) => void;
}) {
  const skills = useTradeQuery<Skill[]>("/chat/skills"),
    action = useAction(),
    [frequency, setFrequency] = useState(task?.frequency || "daily"),
    [skill, setSkill] = useState(task?.skill_id || "general");
  return (
    <Modal title={task?.id ? "编辑任务" : "新建任务"} onClose={onClose} wide>
      <form
        className="trade-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget),
            values = {
              ...Object.fromEntries(form),
              weekday: Number(form.get("weekday") || 0),
              enabled: form.get("enabled") === "on",
            };
          void action.run(
            () =>
              tradeApi<Automation>(
                task?.id ? `/automations/${task.id}` : "/automations",
                jsonBody(task?.id ? "PUT" : "POST", values),
              ),
            "任务已保存",
            (v) => {
              onSaved(v);
              onClose();
            },
          );
        }}
      >
        <Field label="任务名称">
          <input className="input" name="name" defaultValue={task?.name || ""} required />
        </Field>
        <Field label="任务指令">
          <textarea className="textarea" name="prompt" defaultValue={task?.prompt || ""} rows={5} required />
        </Field>
        <div className="form-grid">
          <Field label="技能">
            <select
              className="select"
              name="skill_id"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
            >
              {skills.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="执行频率">
            <select
              name="frequency"
              className="select"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              {[
                ["daily", "每天"],
                ["weekdays", "工作日"],
                ["weekly", "每周"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {t(label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="执行时间（北京时间）">
            <input
              className="input"
              name="time_of_day"
              type="time"
              defaultValue={task?.time_of_day || "09:00"}
              required
            />
          </Field>
          <Field label="每周执行日">
            <select
              className="select"
              name="weekday"
              defaultValue={task?.weekday || 0}
              disabled={frequency !== "weekly"}
            >
              {["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"].map((v, i) => (
                <option key={v} value={i}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="inline-check">
          <input type="checkbox" name="enabled" defaultChecked={task?.enabled ?? true} />
          {t("启用任务")}
        </label>
        <button className="btn btn-primary" disabled={action.busy}>
          {t("保存")}
        </button>
      </form>
    </Modal>
  );
}
export function Tasks() {
  const query = useTradeQuery<Automation[]>("/automations"),
    runs = useTradeQuery<AutomationRun[]>("/automation-runs"),
    [id, setId] = useSelection(),
    [editor, setEditor] = useState<Partial<Automation> | null>(null),
    action = useAction();
  const selected = query.data?.find((v) => String(v.id) === id) || query.data?.[0];
  return (
    <Shell
      title={t("定时任务")}
      actions={
        <>
          <select
            className="select"
            aria-label={t("任务模板")}
            value=""
            onChange={(e) => setEditor(taskTemplates[Number(e.target.value)])}
          >
            <option value="">{t("选择任务模板")}</option>
            {taskTemplates.map((v, i) => (
              <option key={v.name} value={i}>
                {t(v.name)}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setEditor({})}>
            {t("新建任务")}
          </button>
        </>
      }
    >
      <QueryState query={query} />
      <ListDetail
        list={query.data?.map((v) => (
          <SelectCard key={v.id} title={v.name} active={selected?.id === v.id} onClick={() => setId(v.id)}>
            <Tag>{t(v.enabled ? "启用" : "暂停")}</Tag>
            <span>{v.time_of_day}</span>
          </SelectCard>
        ))}
      >
        {selected ? (
          <>
            <h2>{selected.name}</h2>
            <div className="toolbar">
              <button className="btn" onClick={() => setEditor(selected)}>
                {t("编辑")}
              </button>
              <button
                className="btn"
                disabled={action.busy}
                onClick={() =>
                  action.run(
                    () => tradeApi(`/automations/${selected.id}/run`, jsonBody("POST")),
                    "任务已执行",
                  )
                }
              >
                {t("立即执行")}
              </button>
              <button
                className="btn"
                onClick={() =>
                  action.run(
                    () =>
                      tradeApi(
                        `/automations/${selected.id}`,
                        jsonBody("PUT", { enabled: !selected.enabled }),
                      ),
                    "任务状态已更新",
                  )
                }
              >
                {t(selected.enabled ? "暂停任务" : "启用任务")}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (confirm(t("确定删除“{name}”？", { name: selected.name })))
                    void action.run(
                      () => tradeApi(`/automations/${selected.id}`, jsonBody("DELETE")),
                      "任务已删除",
                      () => setId(""),
                    );
                }}
              >
                {t("删除任务")}
              </button>
            </div>
            <p className="detail-copy hint">
              {t("下次运行时间")} · {selected.next_run_at}
            </p>
            <Markdown text={selected.prompt} />
            <h3>{t("最近运行记录")}</h3>
            <QueryState query={runs} />
            {runs.data
              ?.filter((v) => v.automation_id === selected.id)
              .map((v) => (
                <details className="thinking" key={v.id}>
                  <summary>
                    {v.started_at} · {t(v.status)}
                  </summary>
                  {v.error && <div className="banner bad">{v.error}</div>}
                  <Markdown text={v.output || ""} />
                </details>
              ))}
          </>
        ) : (
          <Blank />
        )}
      </ListDetail>
      {editor && <TaskEditor task={editor} onClose={() => setEditor(null)} onSaved={(v) => setId(v.id)} />}
    </Shell>
  );
}
export function conversationHref(conversation: TradeConversation) {
  const skill = conversation.messages?.find((v) => v.role === "user")?.skill_id || conversation.skill_id;
  const ctx = Object.entries(CONTEXTS).find(([, v]) => v.skill === skill)?.[0] || "daily";
  return ctx === "daily" ? `/?c=${conversation.id}` : `/chat?ctx=${ctx}&c=${conversation.id}`;
}
export function History() {
  const chats = useTradeChatStates();
  const query = useTradeQuery<TradeConversation[]>("/conversations"),
    [id, setId] = useSelection(),
    action = useAction();
  const selected = id || String(query.data?.[0]?.id || ""),
    detail = useTradeQuery<TradeConversation>(`/conversations/${selected}`, !!selected);
  return (
    <Shell title={t("对话记录")}>
      <QueryState query={query} />
      <ListDetail
        list={query.data?.map((v) => (
          <SelectCard
            key={v.id}
            title={v.title}
            active={selected === String(v.id)}
            onClick={() => setId(v.id)}
          >
            <span>{v.updated_at}</span>
          </SelectCard>
        ))}
      >
        {detail.data ? (
          <>
            <h2>{detail.data.title}</h2>
            <div className="toolbar">
              <Link className="btn btn-primary" href={conversationHref(detail.data)}>
                {t("继续对话")}
              </Link>
              <button
                className="btn"
                disabled={Object.values(chats).some((chat) => chat.busy && String(chat.cid) === selected)}
                onClick={() => {
                  if (confirm(t("确定删除这段对话吗？")))
                    void action.run(
                      () => tradeApi(`/conversations/${selected}`, jsonBody("DELETE")),
                      "对话已删除",
                      () => setId(""),
                    );
                }}
              >
                {t("删除")}
              </button>
            </div>
            {detail.data.messages?.map((v, i) => (
              <div className={`chat-message ${v.role}`} key={i}>
                <div className="chat-message-label">{t(v.role === "user" ? "你" : "助手")}</div>
                <Markdown text={v.content} />
              </div>
            ))}
          </>
        ) : selected ? (
          <QueryState query={detail} />
        ) : (
          <Blank />
        )}
      </ListDetail>
    </Shell>
  );
}

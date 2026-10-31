"use client";
import Link from "next/link";
import { useState } from "react";
import { t } from "@/i18n/runtime";
import { tradeApi, jsonBody } from "@/lib/api";
import type { Customer, CustomerPage, Library, TradeOrder } from "@/lib/trade-types";
import { Shell } from "./shell";
import { Tabs, Tag } from "./ui";
import {
  Field,
  Modal,
  ListDetail,
  SelectCard,
  QueryState,
  Blank,
  FileButton,
  useAction,
  useTradeQuery,
  useSelection,
} from "./trade-ui";
import { CustomerTariff, RiskBadge } from "./tariff-bridge";
import { OrderEditor } from "./trade-orders";

export const customerFields: [keyof Customer, string][] = [
  ["name", "客户名称"],
  ["contact", "联系人"],
  ["country", "国家"],
  ["tier", "客户等级"],
  ["email", "邮箱"],
  ["backup_email", "备用邮箱"],
  ["phone", "电话"],
  ["whatsapp", "WhatsApp"],
  ["wechat", "微信"],
  ["company_website", "公司网站"],
  ["linkedin_url", "LinkedIn 链接"],
  ["title", "职位"],
  ["source", "来源"],
  ["buyer_type", "采购商类型"],
  ["main_category", "主营品类"],
  ["match_score", "匹配评分"],
  ["social_media", "社交媒体"],
  ["follow_up_note", "跟进备注"],
  ["note", "备注"],
];
function CustomerEditor({
  customer,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  onClose: () => void;
  onSaved: (v: Customer) => void;
}) {
  const action = useAction();
  return (
    <Modal title={customer ? "编辑客户" : "添加客户"} onClose={onClose} wide>
      <form
        className="trade-form"
        onSubmit={(e) => {
          e.preventDefault();
          const values: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget));
          values.match_score = Number(values.match_score);
          try {
            values.social_media = JSON.parse(String(values.social_media || "{}"));
          } catch {
            void action.run(() => Promise.reject(new Error(t("社交媒体须为 JSON 对象"))));
            return;
          }
          void action.run(
            () =>
              tradeApi<Customer>(
                customer ? `/customers/${customer.id}` : "/customers",
                jsonBody(customer ? "PUT" : "POST", values),
              ),
            customer ? "客户已更新" : "客户已添加",
            (v) => {
              onSaved(v);
              onClose();
            },
          );
        }}
      >
        <div className="form-grid">
          {customerFields.map(([key, label]) => (
            <Field key={key} label={label}>
              {key === "tier" ? (
                <select name={key} className="select" defaultValue={customer?.tier || ""}>
                  {["", "A", "B", "C"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : key === "note" || key === "follow_up_note" || key === "social_media" ? (
                <textarea
                  className="textarea"
                  name={key}
                  rows={3}
                  maxLength={key === "social_media" ? 20000 : 20000}
                  defaultValue={
                    key === "social_media"
                      ? JSON.stringify(customer?.social_media || {}, null, 2)
                      : String(customer?.[key] || "")
                  }
                />
              ) : (
                <input
                  className="input"
                  name={key}
                  type={key === "match_score" ? "number" : "text"}
                  min={key === "match_score" ? 0 : undefined}
                  max={key === "match_score" ? 5 : undefined}
                  maxLength={key === "name" ? 200 : 2000}
                  required={key === "name"}
                  defaultValue={String(customer?.[key] ?? (key === "match_score" ? 0 : ""))}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="toolbar">
          <button type="button" className="btn" onClick={onClose}>
            {t("取消")}
          </button>
          <button className="btn btn-primary" disabled={action.busy}>
            {t("保存")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CustomerDetail({
  customer,
  onEdit,
  onDelete,
}: {
  customer: Customer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useSelection("tab"),
    [orderOpen, setOrderOpen] = useState(false),
    action = useAction();
  const libraries = useTradeQuery<Library[]>("/libraries"),
    linked = useTradeQuery<Library[]>(`/customers/${customer.id}/libraries`),
    orders = useTradeQuery<TradeOrder[]>("/orders");
  const current = tab || "fields";
  return (
    <>
      <div className="toolbar push">
        <div>
          <div className="device-tag">
            {customer.country} · {customer.tier || "—"}
          </div>
          <h2>{customer.name}</h2>
        </div>
        <RiskBadge kind="customer" id={customer.id} />
      </div>
      <div className="toolbar">
        <button className="btn" onClick={onEdit}>
          {t("编辑")}
        </button>
        <button className="btn btn-danger-text" onClick={onDelete}>
          {t("删除")}
        </button>
        <Link className="btn" href={`/chat?ctx=lead&customer=${customer.id}`}>
          {t("与此客户对话")}
        </Link>
      </div>
      <Tabs
        value={current}
        onChange={setTab}
        items={[
          ["fields", "客户资料"],
          ["libraries", "文档库"],
          ["orders", "订单"],
          ["tariff", "关税风险"],
        ].map(([id, label]) => ({ id, label: t(label) }))}
      />
      {current === "fields" && (
        <table className="kv-table">
          <tbody>
            {customerFields.map(([key, label]) => (
              <tr key={key}>
                <th>{t(label)}</th>
                <td>
                  {key === "social_media"
                    ? Object.entries(customer.social_media)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")
                    : String(customer[key] ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {current === "libraries" && (
        <>
          <h3>{t("关联文档库")}</h3>
          <QueryState query={linked} />
          {libraries.data?.map((l) => (
            <label className="link-row" key={l.id}>
              <input
                type="checkbox"
                checked={!!linked.data?.some((v) => v.id === l.id)}
                disabled={action.busy}
                onChange={(e) =>
                  action.run(
                    () =>
                      tradeApi(
                        `/customers/${customer.id}/libraries/${l.id}`,
                        jsonBody(e.target.checked ? "POST" : "DELETE"),
                      ),
                    "文档库关联已更新",
                  )
                }
              />
              {l.name}
            </label>
          ))}
        </>
      )}
      {current === "orders" && (
        <>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => setOrderOpen(true)}>
              {t("新增订单")}
            </button>
          </div>
          {orders.data
            ?.filter((v) => v.customer_id === customer.id)
            .map((v) => (
              <Link className="menu-item" key={v.id} href={`/orders?id=${v.id}`}>
                {v.order_no || `#${v.id}`} · {t(v.status)} · {v.currency} {v.total_amount ?? t("待谈")}
              </Link>
            ))}
        </>
      )}
      {current === "tariff" && <CustomerTariff id={customer.id} />}
      {orderOpen && <OrderEditor customerId={customer.id} onClose={() => setOrderOpen(false)} />}
    </>
  );
}
export function Customers() {
  const [q, setQ] = useState(""),
    [tier, setTier] = useState(""),
    [offset, setOffset] = useState(0),
    [id, setId] = useSelection(),
    [editor, setEditor] = useState<Customer | "new" | null>(null),
    action = useAction();
  const query = useTradeQuery<CustomerPage>(
    `/customers?q=${encodeURIComponent(q)}&tier=${tier}&limit=50&offset=${offset}`,
  );
  const selected = id || String(query.data?.items[0]?.id || "");
  const detail = useTradeQuery<Customer>(`/customers/${selected}`, !!selected);
  return (
    <Shell
      title={t("客户管理")}
      actions={
        <>
          <input
            className="input"
            placeholder={t("搜索客户")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
              setId("");
            }}
          />
          <select
            className="select"
            aria-label={t("客户等级")}
            value={tier}
            onChange={(e) => {
              setTier(e.target.value);
              setOffset(0);
              setId("");
            }}
          >
            <option value="">{t("全部等级")}</option>
            {["A", "B", "C"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <span className="spacer" />
          <FileButton
            label="导入 CSV"
            accept=".csv"
            onFile={(file) =>
              action.run(
                async () => tradeApi("/customers/import", jsonBody("POST", { content: await file.text() })),
                "客户已导入",
              )
            }
          />
          <a className="btn" href={`/api/customers/export?q=${encodeURIComponent(q)}&tier=${tier}`}>
            {t("导出 CSV")}
          </a>
          <button className="btn btn-primary" onClick={() => setEditor("new")}>
            {t("添加客户")}
          </button>
        </>
      }
    >
      <QueryState query={query} />
      <ListDetail
        list={
          <>
            <div className="list-head">
              <span>{t("共 {n} 条", { n: query.data?.total || 0 })}</span>
              <div className="toolbar">
                <button
                  className="btn"
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - 50))}
                >
                  {t("上一页")}
                </button>
                <button
                  className="btn"
                  disabled={offset + 50 >= (query.data?.total || 0)}
                  onClick={() => setOffset((v) => v + 50)}
                >
                  {t("下一页")}
                </button>
              </div>
            </div>
            {query.data?.items.map((c) => (
              <SelectCard
                key={c.id}
                title={c.name}
                active={String(c.id) === selected}
                onClick={() => setId(c.id)}
              >
                <span>{c.country || "—"}</span>
                <Tag>{c.tier || "—"}</Tag>
                <RiskBadge kind="customer" id={c.id} />
              </SelectCard>
            ))}
          </>
        }
      >
        {detail.data ? (
          <CustomerDetail
            key={detail.data.id}
            customer={detail.data}
            onEdit={() => setEditor(detail.data!)}
            onDelete={() => {
              if (confirm(t("确定删除“{name}”？", { name: detail.data!.name })))
                void action.run(
                  () => tradeApi(`/customers/${selected}`, jsonBody("DELETE")),
                  "客户已删除",
                  () => setId(""),
                );
            }}
          />
        ) : selected ? (
          <QueryState query={detail} />
        ) : (
          <Blank />
        )}
      </ListDetail>
      {editor && (
        <CustomerEditor
          customer={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={(v) => setId(v.id)}
        />
      )}
    </Shell>
  );
}

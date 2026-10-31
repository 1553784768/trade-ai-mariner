"use client";
import Link from "next/link";
import { useState } from "react";
import { t } from "@/i18n/runtime";
import { tradeApi, jsonBody } from "@/lib/api";
import type { TradeOrder, TradeOrderItem, CustomerPage } from "@/lib/trade-types";
import { Shell } from "./shell";
import { Tabs, Tag } from "./ui";
import {
  Field,
  Modal,
  ListDetail,
  SelectCard,
  QueryState,
  Blank,
  useAction,
  useTradeQuery,
  useSelection,
} from "./trade-ui";
import { OrderTariff, RiskBadge } from "./tariff-bridge";

const transitions: Record<string, string[]> = {
  报价中: ["已下单", "已取消"],
  已下单: ["已出货", "已取消"],
  已出货: ["已完成"],
  已完成: [],
  已取消: [],
};
export function OrderEditor({
  order,
  customerId,
  onClose,
  onSaved,
}: {
  order?: TradeOrder;
  customerId?: number;
  onClose: () => void;
  onSaved?: (v: TradeOrder) => void;
}) {
  const customers = useTradeQuery<CustomerPage>("/customers?limit=100"),
    action = useAction();
  const [selectedCustomer, setSelectedCustomer] = useState(String(customerId || ""));
  const [items, setItems] = useState<TradeOrderItem[]>(
    order?.items || [{ product_name: "", quantity: null, unit: "", unit_price: null }],
  );
  return (
    <Modal title={order ? "编辑订单" : "新增订单"} onClose={onClose} wide>
      <form
        className="trade-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          const values = {
            ...data,
            items: items.map(({ product_name, quantity, unit, unit_price }) => ({
              product_name,
              quantity: quantity === "" ? null : quantity,
              unit,
              unit_price: unit_price === "" ? null : unit_price,
            })),
            ...(!order ? { customer_id: Number(data.customer_id) } : {}),
          };
          void action.run(
            () =>
              tradeApi<TradeOrder>(
                order ? `/orders/${order.id}` : "/orders",
                jsonBody(order ? "PUT" : "POST", values),
              ),
            "订单已保存",
            (v) => {
              onSaved?.(v);
              onClose();
            },
          );
        }}
      >
        <div className="form-grid">
          {!order && (
            <Field label="客户">
              <select
                className="select"
                name="customer_id"
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
                required
              >
                <option value="">{t("请选择")}</option>
                {customers.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {[
            ["order_no", "订单号"],
            ["currency", "币种"],
            ["delivery_date", "交货日"],
            ["payment_terms", "付款条款"],
          ].map(([key, label]) => (
            <Field label={label} key={key}>
              <input
                className="input"
                name={key}
                type={key === "delivery_date" ? "date" : "text"}
                defaultValue={String(order?.[key as keyof TradeOrder] ?? (key === "currency" ? "USD" : ""))}
                required={key === "currency"}
                pattern={key === "currency" ? "[A-Z]{3}" : undefined}
              />
            </Field>
          ))}
        </div>
        <h3>{t("商品明细")}</h3>
        {items.map((item, index) => (
          <div className="card conversion-card" key={index}>
            <div className="form-grid">
              {[
                ["product_name", "商品名称"],
                ["quantity", "数量"],
                ["unit", "单位"],
                ["unit_price", "单价"],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    className="input"
                    aria-label={`${t(label)} ${index + 1}`}
                    required={key === "product_name"}
                    type={key === "quantity" || key === "unit_price" ? "number" : "text"}
                    min="0"
                    step="any"
                    value={item[key as keyof TradeOrderItem] ?? ""}
                    onChange={(e) =>
                      setItems((current) =>
                        current.map((v, i) => (i === index ? { ...v, [key]: e.target.value } : v)),
                      )
                    }
                  />
                </Field>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              disabled={items.length === 1}
              onClick={() => setItems((v) => v.filter((_, i) => i !== index))}
            >
              {t("删除商品")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={items.length >= 100}
          onClick={() =>
            setItems((v) => [...v, { product_name: "", quantity: null, unit: "", unit_price: null }])
          }
        >
          {t("添加商品")}
        </button>
        <Field label="备注">
          <textarea name="notes" className="textarea" rows={3} defaultValue={order?.notes || ""} />
        </Field>
        <p className="field-help">{t("单价可留空，表示待谈。")}</p>
        <div className="toolbar">
          <button type="button" className="btn" onClick={onClose}>
            {t("取消")}
          </button>
          <button className="btn btn-primary" disabled={action.busy}>
            {t("保存订单")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Orders() {
  const query = useTradeQuery<TradeOrder[]>("/orders"),
    [id, setId] = useSelection(),
    [tab, setTab] = useSelection("tab"),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [editor, setEditor] = useState<TradeOrder | "new" | null>(null),
    [changed, setChanged] = useState(false),
    action = useAction();
  const items = query.data?.filter(
    (v) =>
      (!q || `${v.order_no} ${v.customer_name}`.toLowerCase().includes(q.toLowerCase())) &&
      (!status || status === v.status),
  );
  const selected = id || String(items?.[0]?.id || ""),
    detail = useTradeQuery<TradeOrder>(`/orders/${selected}`, !!selected),
    order = detail.data;
  return (
    <Shell
      title={t("订单")}
      actions={
        <>
          <input
            className="input"
            placeholder={t("搜索订单")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="select"
            aria-label={t("订单状态")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("全部状态")}</option>
            {Object.keys(transitions).map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setEditor("new")}>
            {t("新增订单")}
          </button>
        </>
      }
    >
      <QueryState query={query} />
      <ListDetail
        list={items?.map((v) => (
          <SelectCard
            key={v.id}
            active={selected === String(v.id)}
            title={v.order_no || `#${v.id}`}
            onClick={() => {
              setId(v.id);
              setChanged(false);
            }}
          >
            <span>{v.customer_name}</span>
            <Tag>{t(v.status)}</Tag>
            <RiskBadge kind="order" id={v.id} />
          </SelectCard>
        ))}
      >
        {order ? (
          <>
            <div className="device-tag">
              <Link href={`/customers?id=${order.customer_id}`}>{order.customer_name}</Link> ·{" "}
              {t(order.status)}
            </div>
            <h2>{order.order_no || `#${order.id}`}</h2>
            <div className="toolbar">
              <button className="btn" onClick={() => setEditor(order)}>
                {t("编辑")}
              </button>
              <a className="btn" href={`/api/orders/${order.id}/quotation`} target="_blank" rel="noreferrer">
                {t("打印报价单")}
              </a>
              <button
                className="btn btn-danger-text"
                onClick={() => {
                  if (confirm(t("确定删除“{name}”？", { name: order.order_no })))
                    void action.run(
                      () => tradeApi(`/orders/${order.id}`, jsonBody("DELETE")),
                      "订单已删除",
                      () => setId(""),
                    );
                }}
              >
                {t("删除")}
              </button>
              {transitions[order.status]?.map((v) => (
                <button
                  className="btn"
                  key={v}
                  disabled={action.busy}
                  onClick={() =>
                    action.run(
                      () => tradeApi(`/orders/${order.id}`, jsonBody("PUT", { status: v })),
                      "订单状态已更新",
                      () => setChanged(true),
                    )
                  }
                >
                  {t(v)}
                </button>
              ))}
            </div>
            {changed && (
              <div className="banner info">{t("订单状态已更新，可在关税影响中同步到关联的关税订单。")}</div>
            )}
            <Tabs
              value={tab || "items"}
              onChange={setTab}
              items={[
                ["items", "商品明细"],
                ["details", "订单资料"],
                ["tariff", "关税影响"],
              ].map(([id, label]) => ({ id, label: t(label) }))}
            />
            {(!tab || tab === "items") && (
              <table className="table">
                <thead>
                  <tr>
                    {["商品", "数量", "单位", "单价", "金额"].map((v) => (
                      <th key={v}>{t(v)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((v, i) => (
                    <tr key={i}>
                      <td>{v.product_name}</td>
                      <td>{v.quantity ?? t("待谈")}</td>
                      <td>{v.unit}</td>
                      <td>{v.unit_price ?? t("待谈")}</td>
                      <td>{v.total_amount ?? t("待谈")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>{t("合计")}</td>
                    <td>
                      {order.currency} {order.total_amount ?? t("待谈")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
            {tab === "details" && (
              <table className="kv-table">
                <tbody>
                  {[
                    ["交货日", order.delivery_date],
                    ["付款条款", order.payment_terms],
                    ["备注", order.notes],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <th>{t(k)}</th>
                      <td>{v || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === "tariff" && <OrderTariff id={order.id} status={order.status} />}
          </>
        ) : selected ? (
          <QueryState query={detail} />
        ) : (
          <Blank />
        )}
      </ListDetail>
      {editor && (
        <OrderEditor
          order={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={(v) => setId(v.id)}
        />
      )}
    </Shell>
  );
}

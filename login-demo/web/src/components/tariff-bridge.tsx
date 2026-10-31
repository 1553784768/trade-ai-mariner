"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle } from "@tabler/icons-react";
import { t } from "@/i18n/runtime";
import { api, tradeApi, jsonBody, ApiFailure, type Schema } from "@/lib/api";
import type { CustomerPage, TariffDraft, TariffImpact, TariffLink, TariffSummary } from "@/lib/trade-types";
import { formatMoney } from "@/lib/format";
import { decisionLabels } from "@/lib/labels";
import { riskTone, Tag, EmptyPanel } from "./ui";
import { Modal, useTradeQuery, QueryState, useAction, useToast } from "./trade-ui";

export function TariffSummaryCard() {
  const query = useQuery({
    queryKey: ["trade-tariff", "summary"],
    queryFn: () => tradeApi<TariffSummary>("/trade-tariff/summary"),
  });
  return (
    <section className="card tariff-summary">
      <h3>
        <IconAlertTriangle size={16} />
        {t("关税风险摘要")}
      </h3>
      <QueryState query={query} />
      {query.data && !query.data.opened ? (
        <>
          <p className="detail-copy">{t("本公司尚未启用关税风险模块。")}</p>
          <Link className="btn" href="/tariff">
            {t("打开关税工作台")}
          </Link>
        </>
      ) : (
        query.data?.meta && (
          <>
            <div className="toolbar">
              {[
                ["pending", "待处理"],
                ["red", "红色"],
                ["urgent", "紧急"],
                ["drafts_pending", "待审核规则"],
              ].map(([key, label]) => (
                <span key={key} className="stat-chip">
                  {query.data!.meta!.counts[key as keyof Schema<"Counts">]} {t(label)}
                </span>
              ))}
            </div>
            {query.data.brief && (
              <p>
                {t("政策日报")} {query.data.brief.date}：{query.data.brief.conclusion}
              </p>
            )}
            {query.data.urgent?.map((v) => (
              <Link className="summary-row" key={v.order_id} href={`/tariff/inbox?order=${v.order_id}`}>
                <span>
                  {v.order_id} · {v.product} · {v.customer_name || t("未关联客户")}
                </span>
                <span>
                  <span className={`tone-${riskTone[v.risk_level]}`}>
                    {formatMoney(v.profit_delta_usd, true)}
                  </span>{" "}
                  <Tag tone={riskTone[v.risk_level]}>{t(`${v.risk_level}色风险`)}</Tag>
                </span>
              </Link>
            ))}
            <div className="toolbar">
              <Link href="/tariff/inbox">{t("打开风险收件箱")}</Link>
              <Link href="/tariff/brief">{t("查看政策日报")}</Link>
            </div>
          </>
        )
      )}
    </section>
  );
}
export function RiskBadge({ kind, id }: { kind: "customer" | "order"; id: number }) {
  const status = useQuery({
    queryKey: ["trade-tariff", "status"],
    queryFn: () => tradeApi<TariffSummary>("/trade-tariff/status"),
  });
  const links = useTradeQuery<TariffLink[]>("/trade-tariff/links", !!status.data?.opened);
  const impacts = useQuery({
    queryKey: ["impacts", "all", "all", ""],
    queryFn: () => api<Schema<"ImpactCard">[]>("/impacts"),
    enabled: !!status.data?.opened,
  });
  const ids = new Set(
    links.data
      ?.filter((v) => v[kind === "customer" ? "customer_id" : "order_id"] === id)
      .map((v) => v.tariff_order_id),
  );
  const risks = impacts.data?.filter((v) => ids.has(v.order_id)).map((v) => v.risk_level) || [];
  const risk = ["红", "橙", "黄", "绿"].find((v) => risks.includes(v as Schema<"ImpactCard">["risk_level"]));
  return risk ? (
    <Tag tone={riskTone[risk]}>
      {t("关税")} {t(`${risk}色风险`)}
    </Tag>
  ) : null;
}
export function TariffImpactTable({
  values,
  customer = false,
}: {
  values: TariffImpact[];
  customer?: boolean;
}) {
  if (!values.length)
    return (
      <EmptyPanel>
        {t(
          customer
            ? "暂无关联的关税订单。可在订单详情中生成，或在风险收件箱中把订单关联到此客户。"
            : "此订单还没有生成关税订单。",
        )}
      </EmptyPanel>
    );
  return (
    <table className="table">
      <thead>
        <tr>
          {[
            ...(customer ? ["订单号"] : []),
            "商品",
            "关税订单号",
            "HS 编码",
            "风险",
            "利润变化",
            "决策",
            "倒计时",
          ].map((v) => (
            <th key={v}>{t(v)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {values.map((v) => (
          <tr key={v.tariff_order_id}>
            {customer && <td>{v.order_no || "—"}</td>}
            <td>
              {v.impact?.product || v.item_name}
              {v.stale && <Tag tone="warn">{t("商品已变更")}</Tag>}
            </td>
            <td>
              <Link href={`/tariff/inbox?order=${v.tariff_order_id}`}>{v.tariff_order_id}</Link>
            </td>
            <td>{v.impact?.hts10 || "—"}</td>
            <td>
              {v.impact && (
                <Tag tone={riskTone[v.impact.risk_level]}>{t(`${v.impact.risk_level}色风险`)}</Tag>
              )}
            </td>
            <td className={`num tone-${v.impact ? riskTone[v.impact.risk_level] : ""}`}>
              {v.impact ? formatMoney(v.impact.profit_delta_usd, true) : "—"}
            </td>
            <td>{v.impact && decisionLabels[v.impact.decision]}</td>
            <td>{v.impact?.countdown.days ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function CustomerTariff({ id }: { id: number }) {
  const query = useTradeQuery<TariffImpact[]>(`/trade-tariff/customers/${id}/impacts`);
  return (
    <>
      <QueryState query={query} />
      {query.data && <TariffImpactTable values={query.data} customer />}
    </>
  );
}
export function OrderTariff({ id, status }: { id: number; status: string }) {
  const query = useTradeQuery<TariffImpact[]>(`/trade-tariff/orders/${id}/impacts`),
    action = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="toolbar">
        <button
          className="btn btn-primary"
          disabled={status === "已取消"}
          title={status === "已取消" ? t("已取消的订单不能生成关税订单") : undefined}
          onClick={() => setOpen(true)}
        >
          {t(query.data?.length ? "更新关税订单" : "生成关税订单")}
        </button>
        {!!query.data?.length && (
          <button
            className="btn"
            disabled={action.busy || status === "已取消"}
            onClick={() =>
              action.run(
                () => tradeApi(`/trade-tariff/orders/${id}/sync-status`, jsonBody("POST")),
                "关税订单状态已同步",
              )
            }
          >
            {t("同步订单状态")}
          </button>
        )}
      </div>
      <QueryState query={query} />
      {query.data && <TariffImpactTable values={query.data} />}
      {open && <TariffConvertDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
export function TariffCustomerLink({ id }: { id: string }) {
  const links = useTradeQuery<TariffLink[]>("/trade-tariff/links"),
    customers = useTradeQuery<CustomerPage>("/customers?limit=100"),
    action = useAction();
  const link = links.data?.find((v) => v.tariff_order_id === id);
  return (
    <div className="link-row">
      <label>
        {t("关联客户")}{" "}
        <select
          className="select"
          aria-label={t("关联客户")}
          value={link?.customer_id || ""}
          disabled={!!link?.order_id || action.busy}
          onChange={(e) =>
            action.run(
              () =>
                tradeApi(
                  `/trade-tariff/links/${id}`,
                  jsonBody("PUT", { customer_id: e.target.value ? Number(e.target.value) : null }),
                ),
              "关联客户已更新",
            )
          }
        >
          <option value="">{t("不关联")}</option>
          {customers.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {link?.order_id && <Link href={`/orders?id=${link.order_id}`}>{t("查看订单")}</Link>}
      {link?.customer_id && <Link href={`/customers?id=${link.customer_id}`}>{t("查看客户")}</Link>}
    </div>
  );
}
const fields: [string, string][] = [
  ["order_id", "关税订单号"],
  ["product", "品名"],
  ["hts10", "HS 编码"],
  ["origin", "原产地"],
  ["incoterm", "贸易术语"],
  ["channel", "渠道"],
  ["importer_of_record", "进口商"],
  ["tariff_clause", "合同关税条款"],
  ["status", "状态"],
  ["transport_mode", "运输方式"],
  ["qty", "数量"],
  ["unit_price_usd", "单价（美元）"],
  ["purchase_cost_cny_per_unit", "单位采购成本（人民币）"],
  ["other_cost_cny_per_unit", "单位其他成本（人民币）"],
  ["fx_cny_per_usd", "人民币兑美元汇率"],
  ["intl_freight_usd", "国际运费（美元）"],
  ["insurance_usd", "保险费（美元）"],
  ["us_side_cost_usd", "美国端费用（美元）"],
  ["customs_value_usd", "报关货值（美元）"],
  ["baseline_duty_rate_pct", "报价基准税率（%）"],
  ["target_margin_pct", "目标毛利率（%）"],
  ["quote_date", "报价日"],
  ["load_date", "装船日"],
  ["entry_date", "入境日"],
  ["delivery_date", "交货日"],
];
const options: Record<string, string[]> = {
  incoterm: ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"],
  channel: ["b2b", "ecom"],
  importer_of_record: ["seller", "buyer"],
  transport_mode: ["ocean", "air", "postal"],
};
const optionLabels: Record<string, string> = {
  b2b: "B2B",
  ecom: "电商",
  seller: "卖方",
  buyer: "买方",
  ocean: "海运",
  air: "空运",
  postal: "邮寄",
};
function ConversionForm({ draft, id, onClose }: { draft: TariffDraft; id: number; onClose: () => void }) {
  const [rows, setRows] = useState(draft.rows.map((r) => ({ ...r, selected: !r.stale }))),
    [error, setError] = useState<ApiFailure | null>(null),
    [busy, setBusy] = useState(false);
  const action = useAction(),
    toast = useToast();
  const update = (index: number, key: string, value: string) =>
    setRows((current) =>
      current.map((r, i) =>
        i === index
          ? {
              ...r,
              values: {
                ...r.values,
                [key]: value,
                ...(key === "incoterm" ? { importer_of_record: value === "DDP" ? "seller" : "buyer" } : {}),
              },
            }
          : r,
      ),
    );
  const selected = rows.filter((r) => r.selected && !r.stale);
  const errors = Array.isArray(error?.details)
    ? (error.details as { row: number; field: string; message: string }[])
    : [];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const result = await tradeApi<{ imported: number; updated: number }>(
            `/trade-tariff/orders/${id}/convert`,
            jsonBody("POST", {
              rows: selected.map((r) => ({ item_position: r.item_position, values: r.values })),
            }),
          );
          toast(t("已生成 {imported} 张、更新 {updated} 张关税订单", result));
          await action.run(async () => result, "", onClose);
        } catch (error) {
          setError(error as ApiFailure);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <div className="banner bad" role="alert">
          <div>
            {error.message}
            {errors.map((v, i) => (
              <div key={i}>
                {t("第 {row} 行", { row: v.row })} · {v.field} · {v.message}
              </div>
            ))}
          </div>
        </div>
      )}
      {rows.map((row, index) => (
        <section className="card conversion-card" key={`${row.tariff_order_id}-${index}`}>
          <h3>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={row.selected}
                disabled={row.stale}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, selected: e.target.checked } : r)),
                  )
                }
              />
              {t("生成此商品")} · {row.product_name} {row.existing && <Tag>{t("已生成")}</Tag>}
              {row.stale && <Tag tone="warn">{t("商品已变更")}</Tag>}
            </label>
          </h3>
          {row.stale ? (
            <p>
              {row.tariff_order_id} · {t("订单商品已修改，请检查原有关联。")}
            </p>
          ) : (
            <>
              {[fields.slice(0, 10), fields.slice(10, 21), fields.slice(21)].map((group, g) => (
                <div key={g}>
                  <h4>{t(["基本信息", "数量与成本", "日期"][g])}</h4>
                  <div className="form-grid">
                    {group.map(([key, label]) => {
                      const fieldError = errors.find(
                        (e) => selected[e.row - 1]?.item_position === row.item_position && e.field === key,
                      );
                      return (
                        <label key={key} className={`field${fieldError ? " invalid" : ""}`}>
                          <span>{t(label)}</span>
                          {key === "hts10" ? (
                            <select
                              className="select"
                              value={row.values[key] ?? ""}
                              disabled={!row.selected}
                              onChange={(e) => update(index, key, e.target.value)}
                            >
                              <option value="">{t("请选择")}</option>
                              {draft.hts_options.map((v) => (
                                <option key={v.hts10} value={v.hts10}>
                                  {v.hts10} · {v.desc}
                                </option>
                              ))}
                            </select>
                          ) : key === "tariff_clause" ? (
                            <>
                              <select
                                className="select"
                                value={
                                  String(row.values[key] || "none").startsWith("share:") ? "share" : "none"
                                }
                                disabled={!row.selected}
                                onChange={(e) =>
                                  update(index, key, e.target.value === "share" ? "share:0.5" : "none")
                                }
                              >
                                <option value="none">{t("无分摊条款")}</option>
                                <option value="share">{t("按比例分摊")}</option>
                              </select>
                              {String(row.values[key]).startsWith("share:") && (
                                <input
                                  className="input"
                                  type="number"
                                  aria-label={t("卖方承担比例")}
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  required
                                  disabled={!row.selected}
                                  value={String(row.values[key]).slice(6)}
                                  onChange={(e) => update(index, key, `share:${e.target.value}`)}
                                />
                              )}
                            </>
                          ) : options[key] ? (
                            <select
                              className="select"
                              value={row.values[key] ?? ""}
                              disabled={!row.selected}
                              onChange={(e) => update(index, key, e.target.value)}
                            >
                              <option value="">{t("请选择")}</option>
                              {options[key].map((v) => (
                                <option key={v} value={v}>
                                  {t(optionLabels[v] || v)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="input"
                              aria-label={`${row.product_name} ${key}`}
                              value={row.values[key] ?? ""}
                              readOnly={key === "origin" || key === "status"}
                              disabled={!row.selected}
                              type={key.endsWith("_date") ? "date" : g === 1 ? "number" : "text"}
                              step="any"
                              onChange={(e) => update(index, key, e.target.value)}
                            />
                          )}
                          <span className="field-help">
                            {key}
                            {key === "tariff_clause" && ` · ${t("比例范围 0–1")}`}
                            {key === "unit_price_usd" &&
                              draft.order.currency !== "USD" &&
                              ` · ${draft.order.currency} ${draft.order.items[row.item_position]?.unit_price ?? ""} · ${t("请换算为美元")}`}
                          </span>
                          {fieldError && <span className="field-error">{fieldError.message}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="field-help">{t("须满足 报价日 ≤ 装船日 ≤ 入境日 ≤ 交货日")}</p>
            </>
          )}
        </section>
      ))}
      <p className="detail-copy hint">{t("关税订单只保存在本机，由确定性引擎计算，不会发送给模型。")}</p>
      <div className="toolbar">
        <button type="button" className="btn" onClick={onClose}>
          {t("取消")}
        </button>
        <button className="btn btn-primary" disabled={busy || !selected.length}>
          {busy && <span className="spinner" />}
          {t("生成关税订单")}
        </button>
      </div>
    </form>
  );
}
export function TariffConvertDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useTradeQuery<TariffDraft>(`/trade-tariff/orders/${id}/draft`);
  return (
    <Modal title="生成关税订单" onClose={onClose} wide>
      <QueryState query={query} />
      {query.data && <ConversionForm draft={query.data} id={id} onClose={onClose} />}
    </Modal>
  );
}

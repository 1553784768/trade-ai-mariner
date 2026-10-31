"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { api, type Schema } from "@/lib/api";
import { t } from "@/i18n/runtime";
import { Shell } from "@/components/shell";
import { ScoreRing, KeyDatesTimeline } from "@/components/visuals";
import {
  Tag,
  MetricCard,
  LoadingPanel,
  EmptyPanel,
  ErrorBanner,
  Tabs,
  SeverityGrid,
  Flow,
  TextField,
  Switch,
  AuditLog,
  LayerTable,
  ProfitTable,
  ActionList,
  PipelineFlow,
} from "@/components/ui";
export default function Page() {
  const [tab, setTab] = useState("actions"),
    [on, setOn] = useState(false),
    [modal, setModal] = useState(false);
  const detail = useQuery({
    queryKey: ["gallery-impact"],
    queryFn: () => api<Schema<"ImpactDetail">>("/impacts/O5"),
  });
  const audits = useQuery({
    queryKey: ["gallery-audit"],
    queryFn: () => api<Schema<"AuditEvent">[]>("/audit?limit=4"),
  });

  return (
    <Shell title="V01–V22">
      <div className="filter-row">
        <span className="stat-chip">
          <span className="dot good" />
          V01–V22
        </span>
        <div className="dropdown">
          <span className="dropdown-label">{t("类型")}</span>
          <select>
            <option>{t("全部")}</option>
          </select>
        </div>
        <button className="btn" onClick={() => setModal(true)}>
          {t("导入订单 CSV")}
        </button>
      </div>
      <div className="card">
        <h2 className="card-head">V04 · V06 · V07 · V14</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
          {["bad", "warn", "caution", "good"].map((tone, i) => (
            <MetricCard
              key={tone}
              label={t(["红色风险", "橙色风险", "黄色风险", "绿色风险"][i])}
              value={i === 0 ? "−$16,000.00" : i === 3 ? "+$1,500.00" : "—"}
              unit="USD"
              tone={tone}
              bar={[41.9, 42.8, 40.9, 12.5][i]}
              marker={16.9}
            >
              <div className="metric-meta">
                <Tag tone={tone}>{t(["红", "橙", "黄", "绿"][i])}</Tag>
              </div>
            </MetricCard>
          ))}
        </div>
        <div className="detail-top">
          <ScoreRing rate={41.9} baseline={16.9} tone="bad" />
          <ScoreRing rate={12.5} baseline={20} tone="good" />
          <ScoreRing rate={145} baseline={null} tone="warn" />
          {[
            "btn",
            "btn btn-primary",
            "btn btn-good",
            "btn btn-warn",
            "btn btn-bad-outline",
            "btn btn-warn-outline",
            "btn btn-danger-text",
          ].map((c, i) => (
            <button key={c} className={c}>
              {i === 2 && <IconCheck />}
              {t(["取消", "保存", "确认规则", "提交", "不处理", "需补充", "删除"][i])}
            </button>
          ))}
        </div>
        <div className="detail-body" style={{ display: "flex", gap: 8 }}>
          {[
            "btn",
            "btn btn-primary",
            "btn btn-good",
            "btn btn-warn",
            "btn btn-bad-outline",
            "btn btn-warn-outline",
            "btn btn-danger-text",
          ].map((c, i) => (
            <button key={c} className={c} disabled>
              {t(["取消", "保存", "确认规则", "提交", "不处理", "需补充", "删除"][i])}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2 className="card-head">V08 · V09 · V10 · V11 · V12 · V13</h2>
        {detail.data && (
          <>
            <div className="detail-top">
              <div className="detail-left wide">
                <div className="device-tag">O5</div>
                <h2 className="detail-heading">{detail.data.product}</h2>
              </div>
            </div>
            <KeyDatesTimeline value={detail.data} />
            <KeyDatesTimeline value={{ ...detail.data, timing_boundary_date: null }} />
            <KeyDatesTimeline value={{ ...detail.data, status: "entered", timing_boundary_date: null }} />
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: "actions", label: t("可执行建议"), count: 4 },
                { id: "layers", label: t("税率分层") },
                { id: "profit", label: t("利润") },
              ]}
            />
            <div className="tab-body">
              {tab === "actions" ? (
                <ActionList actions={detail.data.actions} />
              ) : tab === "layers" ? (
                <LayerTable value={detail.data} />
              ) : (
                <ProfitTable value={detail.data} />
              )}
            </div>
            <SeverityGrid checks={detail.data.checks} />
          </>
        )}
      </div>
      <div className="card">
        <h2 className="card-head">V15 · V16 · V17</h2>
        <div className="detail-body">
          <div className="banner warn">{t("未配置模型：只能回答内置示例问题。")}</div>
          <div className="banner info">{t("显示订单数据")}</div>
          <ErrorBanner error={new Error(t("请求参数不合法"))} retry={() => {}} />
          <EmptyPanel>{t("暂无条目")}</EmptyPanel>
          <LoadingPanel />
          <TextField label={t("标题")} />
          <Switch checked={on} onChange={setOn}>
            {t("显示订单数据")}
          </Switch>
          <Switch checked={!on} onChange={(v) => setOn(!v)}>
            {t("对话可使用订单数据")}
          </Switch>
          <div className="search-box">
            <IconSearch size={14} />
            <input placeholder={t("搜索知识库…")} />
          </div>
        </div>
      </div>
      <div className="card">
        <h2 className="card-head">V18 · V19 · V20</h2>
        <div className="panels" style={{ border: 0, borderRadius: 0 }}>
          <div className="metrics-list">
            <div className="list-head">
              <button className="btn btn-block">+ {t("新对话")}</button>
            </div>
            <div className="conv-item active">
              <div className="conv-text">
                <div className="conv-title">{t("新对话")}</div>
                <div className="conv-time">10-31 19:34</div>
              </div>
            </div>
          </div>
          <div className="chat">
            <div className="chat-head">
              <div className="chat-title">{t("工作台")}</div>
            </div>
            <div className="chat-scroll">
              <div className="msg user">{t("工作台")}</div>
              <div className="msg assistant">{t("思考中…")}</div>
              <div className="msg error">
                {t("无法连接模型服务")}
                <button className="btn">{t("重试")}</button>
              </div>
            </div>
            <div className="chat-input">
              <textarea className="textarea" rows={3} placeholder={t("输入问题，或上传订单文件…")} />
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <h2 className="card-head">V21 · V22</h2>
        <div className="detail-body">
          <PipelineFlow drafts={2} />
          <Flow
            nodes={[
              { name: t("完成"), tone: "good" },
              { name: t("失败"), tone: "bad" },
              { name: t("你（待决定）"), tone: "brand" },
              { name: t("报关行复核（含未核实字段时）"), tone: "dashed" },
            ]}
          />
          <AuditLog events={audits.data || []} />
        </div>
      </div>
      {modal && (
        <div className="overlay">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="gallery-modal">
            <h2 className="modal-head" id="gallery-modal">
              {t("导入订单 CSV")}
            </h2>
            <div className="modal-body">
              <input className="input" type="file" accept=".csv" />
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setModal(false)}>
                {t("取消")}
              </button>
              <button className="btn btn-primary" disabled>
                {t("上传")}
              </button>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

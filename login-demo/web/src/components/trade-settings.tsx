"use client";
import { t } from "@/i18n/runtime";
import { tradeApi, jsonBody } from "@/lib/api";
import type { Company, ModelSettings } from "@/lib/trade-types";
import { Shell } from "./shell";
import { Tabs, Tag } from "./ui";
import { Field, ListDetail, QueryState, useAction, useTradeQuery, useSelection } from "./trade-ui";
import { UnifiedModelSettings } from "./unified-model-settings";
import { useMe } from "./auth";

const companyFields: [keyof Company, string][] = [
  ["name", "公司名称"],
  ["contact_name", "联系人"],
  ["contact_email", "联系邮箱"],
  ["website", "公司网站"],
  ["industry", "行业"],
  ["address", "地址"],
  ["products", "产品"],
  ["target_region", "目标市场"],
  ["agent_identity_md", "智能体身份"],
];
export function SettingsPage() {
  const [tab, setTab] = useSelection("tab"),
    current = tab === "tariff" ? "chat" : tab || "chat",
    action = useAction(),
    me = useMe();
  const model = useTradeQuery<ModelSettings>("/model-settings"),
    company = useTradeQuery<Company>("/company"),
    search = useTradeQuery<{ has_key: boolean }>("/research/settings"),
    memory = useTradeQuery<{ content: string }>("/memory");
  const tabs = [
    ["chat", "模型设置"],
    ["search", "联网搜索"],
    ["company", "公司资料"],
    ["memory", "业务记忆"],
    ["account", "账号"],
  ];
  return (
    <Shell
      title={t("设置")}
      actions={
        <Tabs
          segmented
          value={current}
          onChange={setTab}
          items={tabs.map(([id, label]) => ({ id, label: t(label) }))}
        />
      }
    >
      {current === "chat" ? (
        <UnifiedModelSettings />
      ) : (
        <ListDetail
          list={
            <>
              <section className="metric-card static">
                <div className="device-tag">{t("模型设置")}</div>
                <div className="metric-value sm">{model.data?.model || "—"}</div>
                <Tag>{t(model.data?.has_key ? "已接入" : "未接入")}</Tag>
              </section>
              <section className="metric-card static">
                <div className="device-tag">Tavily</div>
                <Tag>{t(search.data?.has_key ? "已配置" : "未配置")}</Tag>
              </section>
              <section className="metric-card static">
                <div className="device-tag">{t("公司资料")}</div>
                <p>{company.data?.name}</p>
              </section>
            </>
          }
        >
          <h2>{t(tabs.find((v) => v[0] === current)?.[1] || "设置")}</h2>
          {current === "search" && (
            <form
              className="trade-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const key = new FormData(form).get("api_key");
                void action.run(
                  () => tradeApi("/research/settings", jsonBody("PUT", key ? { api_key: key } : {})),
                  "搜索配置已保存",
                  () => form.reset(),
                );
              }}
            >
              <QueryState query={model} />
              <Field label="当前模型">
                <input className="input" value={model.data?.model || t("未配置")} readOnly />
              </Field>
              <Field label="模型接口地址">
                <input className="input" value={model.data?.base_url || t("未配置")} readOnly />
              </Field>
              <Field label="Tavily API Key">
                <input
                  className="input"
                  name="api_key"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t(search.data?.has_key ? "已保存；留空保留" : "填写 API Key")}
                />
              </Field>
              <p className="detail-copy hint">{t("联网搜索会将搜索词发送给 Tavily，密钥加密保存在本机。")}</p>
              <div className="toolbar">
                <button className="btn btn-primary" disabled={action.busy}>
                  {t("保存")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (confirm(t("确定清除密钥？")))
                      void action.run(
                        () => tradeApi("/research/settings", jsonBody("PUT", { clear_key: true })),
                        "密钥已清除",
                      );
                  }}
                >
                  {t("清除密钥")}
                </button>
              </div>
            </form>
          )}
          {current === "company" && (
            <>
              <QueryState query={company} />
              {company.data && (
                <form
                  className="trade-form"
                  key={company.data.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run(
                      () =>
                        tradeApi(
                          "/company",
                          jsonBody("PUT", Object.fromEntries(new FormData(e.currentTarget))),
                        ),
                      "公司资料已保存",
                    );
                  }}
                >
                  <div className="form-grid">
                    {companyFields.map(([key, label]) => (
                      <Field key={key} label={label}>
                        {key === "products" || key === "agent_identity_md" ? (
                          <textarea
                            className="textarea"
                            name={key}
                            rows={6}
                            maxLength={20000}
                            defaultValue={String(company.data![key] || "")}
                          />
                        ) : (
                          <input
                            className="input"
                            name={key}
                            defaultValue={String(company.data![key] || "")}
                            required={key === "name"}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                  <button className="btn btn-primary" disabled={action.busy}>
                    {t("保存")}
                  </button>
                </form>
              )}
            </>
          )}
          {current === "memory" && (
            <>
              <QueryState query={memory} />
              {memory.data && (
                <form
                  className="trade-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run(
                      () =>
                        tradeApi(
                          "/memory",
                          jsonBody("PUT", { content: new FormData(e.currentTarget).get("content") }),
                        ),
                      "业务记忆已保存",
                    );
                  }}
                >
                  <Field label="业务记忆">
                    <textarea
                      name="content"
                      className="textarea"
                      rows={12}
                      maxLength={20000}
                      defaultValue={memory.data.content}
                    />
                  </Field>
                  <p className="detail-copy hint">
                    {t("写给 AI 的长期备注，例如常用报价条款、沟通偏好；会作为背景资料提供给对话模型。")}
                  </p>
                  <button className="btn btn-primary" disabled={action.busy}>
                    {t("保存")}
                  </button>
                </form>
              )}
            </>
          )}
          {current === "account" && (
            <>
              <p>{me.data?.email}</p>
              <button
                className="btn"
                onClick={() =>
                  action.run(
                    () => tradeApi("/logout", jsonBody("POST")),
                    "",
                    () => {
                      location.href = "/login";
                    },
                    false,
                  )
                }
              >
                {t("退出登录")}
              </button>
            </>
          )}
        </ListDetail>
      )}
    </Shell>
  );
}

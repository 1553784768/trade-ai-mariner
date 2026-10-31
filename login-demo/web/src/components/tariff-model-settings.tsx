"use client";
import { t } from "@/i18n/runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Schema } from "@/lib/api";

import { ErrorBanner, LoadingPanel, PrimaryButton, Tag, TextField, MetricCard } from "@/components/ui";
function SettingsForm({ settings }: { settings: Schema<"LlmSettings"> }) {
  const cache = useQueryClient(),
    [base, setBase] = useState(settings.base_url || ""),
    [model, setModel] = useState(settings.model || ""),
    [key, setKey] = useState("");
  const update = () => cache.invalidateQueries();
  const save = useMutation({
    mutationFn: () =>
      api<Schema<"LlmSettings">>("/settings/llm", {
        method: "PUT",
        body: JSON.stringify({ base_url: base, model, ...(key ? { api_key: key } : {}) }),
      }),
    onSuccess: () => {
      setKey("");
      void update();
    },
  });
  const test = useMutation({
    mutationFn: () => api<Schema<"TestConnection">>("/settings/llm/test", { method: "POST" }),
    onSuccess: update,
  });
  const clear = useMutation({
    mutationFn: () => api<Schema<"LlmSettings">>("/settings/llm", { method: "DELETE" }),
    onSuccess: update,
  });
  const busy = save.isPending || test.isPending || clear.isPending,
    error = save.error || test.error || clear.error,
    result = test.data || settings.last_test;
  return (
    <>
      <div className="filter-row">
        <Tag tone={settings.configured ? "good" : "warn"} large>
          {settings.configured ? t("已接入") : t("未接入（使用内置夹具）")}
        </Tag>
      </div>
      {error && (
        <ErrorBanner
          error={error}
          retry={() => {
            if (save.error) save.mutate();
            else if (test.error) test.mutate();
            else clear.mutate();
          }}
        />
      )}
      <div className="panels fill">
        <aside className="metrics-list">
          <MetricCard
            label={t("连接状态")}
            value={settings.configured ? t("已接入") : t("未接入")}
            small
            tone={settings.configured ? "good" : "warn"}
            bar={100}
          />
          <MetricCard label={t("模型名称")} value={settings.model || "—"} small />
          <MetricCard
            label={t("测试连接")}
            value={
              settings.last_test
                ? settings.last_test.ok
                  ? (settings.last_test.latency_ms ?? "—")
                  : t("连接失败")
                : "—"
            }
            unit={settings.last_test?.ok ? "ms" : undefined}
            small
            tone={settings.last_test ? (settings.last_test.ok ? "good" : "bad") : ""}
          />
        </aside>
        <article className="detail-panel">
          <div className="detail-top pad-bottom">
            <div className="detail-left form">
              <div className="device-tag">OpenAI Chat Completions</div>
              <h2 className="detail-heading">{t("模型接入")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <TextField
                  label={t("接口地址")}
                  value={base}
                  placeholder={t("例如 https://api.example.com/v1")}
                  onChange={(e) => setBase(e.target.value)}
                  required
                />
                <div className="field">
                  <label htmlFor="llm-api-key">API Key</label>
                  <input
                    id="llm-api-key"
                    className="input"
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoComplete="off"
                    required={!settings.configured}
                  />
                  {settings.api_key_masked && (
                    <span className="field-help">
                      {t("已保存")}
                      {settings.api_key_masked}
                      {t("，留空则不修改")}
                    </span>
                  )}
                </div>
                <TextField
                  label={t("模型名称")}
                  value={model}
                  placeholder={t("填写服务商提供的模型 ID")}
                  onChange={(e) => setModel(e.target.value)}
                  required
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <PrimaryButton type="submit" disabled={busy}>
                    {t("保存")}
                  </PrimaryButton>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !settings.configured}
                    onClick={() => test.mutate()}
                  >
                    {t("测试连接")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-text"
                    disabled={busy || !settings.configured}
                    onClick={() => clear.mutate()}
                  >
                    {t("清除配置")}
                  </button>
                </div>
              </form>
              {result && (
                <p
                  className="detail-copy"
                  style={{ fontWeight: 600, color: `var(--color-${result.ok ? "good" : "bad"})` }}
                >
                  {result.ok ? t("连接成功") : t("连接失败：{p0}", { p0: result.message })}{" "}
                  {result.latency_ms !== null && `${result.latency_ms} ms`}
                </p>
              )}
              <p className="detail-copy hint">
                {t("接口需兼容 OpenAI Chat Completions 格式（POST")}
                {base || t("{接口地址}")}
                {t("/chat/completions）。未配置时，智能体使用内置夹具。")}
              </p>
            </div>
          </div>
        </article>
      </div>
    </>
  );
}
export function TariffModelSettings() {
  const settings = useQuery({
    queryKey: ["llm-settings"],
    queryFn: () => api<Schema<"LlmSettings">>("/settings/llm"),
  });
  return (
    <>
      {settings.isPending && <LoadingPanel />}
      {settings.error && <ErrorBanner error={settings.error} retry={() => settings.refetch()} />}
      {settings.data && (
        <SettingsForm
          key={`${settings.data.configured}-${settings.data.base_url}-${settings.data.model}`}
          settings={settings.data}
        />
      )}
    </>
  );
}

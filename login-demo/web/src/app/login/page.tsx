"use client";
import Image from "next/image";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { IconArrowUpRight } from "@tabler/icons-react";
import { t } from "@/i18n/runtime";
import { BRAND } from "@/lib/brand";
import { safeNext } from "@/lib/routes";
import { tradeApi, jsonBody } from "@/lib/api";
import { Field } from "@/components/trade-ui";

function Login() {
  const [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter(),
    params = useSearchParams(),
    cache = useQueryClient();
  return (
    <main className="login-wrap">
      <section className="login-showcase" aria-label="望雕 AI 产品介绍">
        <div className="showcase-art">
          <Image
            src="/wangdiao-login-poster.png"
            alt="望雕 AI 外贸智能工作台宣传图"
            fill
            priority
            sizes="(max-width: 900px) 100vw, 58vw"
          />
          <div className="showcase-scrim" />
        </div>
        <div className="showcase-copy">
          <div className="showcase-kicker">
            <span className="kicker-line" />
            外贸增长智能工作台
          </div>
          <h1>望雕 AI</h1>
          <p>
            从客户开发、产品分析到订单与关税风险，把分散的外贸信息变成可执行的增长动作，让每一次出海决策更快、更准、更有底气。
          </p>
          <div className="showcase-points">
            <span>客户开发</span>
            <span>网站诊断</span>
            <span>社媒营销</span>
            <span>海关数据</span>
            <span>订单管理</span>
            <span>关税预警</span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-panel-inner">
          <div className="login-brand">
            <span className="brand-mark">
              <Image src={BRAND.logo} alt="" width={38} height={38} />
            </span>
            <div>
              <strong>{BRAND.name}</strong>
              <small>智能外贸增长工作台</small>
            </div>
          </div>
          <div className="login-heading">
            <span className="eyebrow">欢迎回来</span>
            <h2>{mode === "login" ? "登录你的工作台" : "创建你的工作空间"}</h2>
            <p>
              {mode === "login"
                ? "继续推进你的客户、订单与市场机会。"
                : "注册后，开始用 AI 管理你的外贸增长。"}
            </p>
          </div>
          <div className="segmented login-switch">
            {["login", "register"].map((v) => (
              <button
                key={v}
                className={v === mode ? "active" : ""}
                onClick={() => {
                  setMode(v);
                  setError("");
                }}
              >
                {t(v === "login" ? "登录" : "注册")}
              </button>
            ))}
          </div>
          <form
            className="trade-form login-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(e.currentTarget);
              try {
                await tradeApi("/" + mode, jsonBody("POST", Object.fromEntries(data)));
                cache.clear();
                router.replace(safeNext(params.get("next")));
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="邮箱地址">
              <input
                className="input"
                type="email"
                name="email"
                placeholder="name@company.com"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="密码">
              <input
                className="input"
                type="password"
                name="password"
                placeholder="请输入密码"
                minLength={8}
                maxLength={128}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </Field>
            {error && (
              <div role="alert" className="banner bad">
                {error}
              </div>
            )}
            <button className="btn btn-primary login-submit" disabled={busy}>
              {busy && <span className="spinner" />}
              {t(mode === "login" ? "登录" : "注册")}
              <IconArrowUpRight size={17} />
            </button>
          </form>
          <p className="login-note">安全登录 · 数据仅用于你的专属工作空间</p>
        </div>
        <div className="login-panel-footer">
          <span>Copyright 2026 望雕 AI</span>
          <span>外贸人的 AI 工作伙伴</span>
        </div>
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

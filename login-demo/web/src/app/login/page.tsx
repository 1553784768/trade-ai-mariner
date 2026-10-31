"use client";
import Image from "next/image";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
      <section className="card login-card">
        <div className="login-brand">
          <Image src={BRAND.logo} alt="" width={30} height={30} />
          <strong>{BRAND.name}</strong>
        </div>
        <p className="detail-copy hint">{t("登录以进入你的公司空间")}</p>
        <div className="segmented">
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
          className="trade-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = new FormData(e.currentTarget);
            try {
              await tradeApi(`/${mode}`, jsonBody("POST", Object.fromEntries(data)));
              cache.clear();
              router.replace(safeNext(params.get("next")));
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="邮箱">
            <input className="input" type="email" name="email" autoComplete="email" required />
          </Field>
          <Field label="密码">
            <input
              className="input"
              type="password"
              name="password"
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
          <button className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" />}
            {t(mode === "login" ? "登录" : "注册")}
          </button>
        </form>
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

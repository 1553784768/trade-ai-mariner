"use client";
import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconInbox,
  IconNews,
  IconFileSearch,
  IconGitMerge,
  IconBook,
  IconMessageChatbot,
  IconFileText,
  IconUsers,
  IconTarget,
  IconWorldSearch,
  IconSpeakerphone,
  IconBrandLinkedin,
  IconBuildingWarehouse,
  IconLayoutDashboard,
  IconReceipt,
  IconFolder,
  IconUserSearch,
  IconClock,
  IconHistory,
  IconSettings,
  IconChevronDown,
} from "@tabler/icons-react";
import { t } from "@/i18n/runtime";
import { useI18n } from "@/i18n";
import { api, tradeApi, jsonBody, type Schema } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { normalizePath } from "@/lib/routes";
import { formatTime } from "@/lib/format";
import type { Company, CustomerPage, ModelSettings, Skill, TariffSummary } from "@/lib/trade-types";
import { useMe } from "./auth";
import { ErrorBanner } from "./ui";
import { Field, Modal, useAction, useTradeQuery } from "./trade-ui";

let savedNavScrollTop = 0;

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Schema<"Meta">>("/meta") });
}
function ShellContent({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  projectLabel?: ReactNode;
}) {
  const pathname = normalizePath(usePathname()),
    params = useSearchParams(),
    cache = useQueryClient(),
    router = useRouter();
  const { lang, setLang } = useI18n(),
    me = useMe(),
    company = useTradeQuery<Company>("/company"),
    companies = useTradeQuery<Company[]>("/companies"),
    model = useTradeQuery<ModelSettings>("/model-settings");
  const tariff = pathname === "/tariff" || pathname.startsWith("/tariff/");
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: () => api<Schema<"Meta">>("/meta"),
    enabled: tariff,
  });
  const status = useQuery({
    queryKey: ["trade-tariff", "status"],
    queryFn: () => tradeApi<TariffSummary>("/trade-tariff/status"),
    enabled: !tariff,
  });
  const meta = tariff ? metaQuery.data : status.data?.meta;
  const [time, setTime] = useState(""),
    [companyMenu, setCompanyMenu] = useState(false),
    [profile, setProfile] = useState(false),
    [dialog, setDialog] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const skills = useTradeQuery<Skill[]>("/chat/skills", dialog === "skills"),
    customers = useTradeQuery<CustomerPage>("/customers?limit=1"),
    action = useAction();
  useEffect(() => {
    const update = () => setTime(formatTime(new Date().toISOString()));
    const initial = setTimeout(update, 0),
      timer = setInterval(update, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (me.data && company.data && customers.data && !company.data.products && customers.data.total === 0) {
      const key = `trade.onboarded.${me.data.id}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        const timer = setTimeout(() => setDialog("onboarding"), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [me.data, company.data, customers.data]);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollTop = savedNavScrollTop;
    return () => {
      savedNavScrollTop = nav.scrollTop;
    };
  }, []);
  const sections = [
    { label: "工作台", links: [["/", "今日简报", IconLayoutDashboard]] },
    {
      label: "获客引流",
      links: [
        ["/chat?ctx=lead", "客户开发", IconTarget],
        ["/chat?ctx=platform", "网站诊断", IconWorldSearch],
        ["/chat?ctx=social", "社媒营销", IconSpeakerphone],
        ["/chat?ctx=linkedin", "LinkedIn", IconBrandLinkedin],
        ["/chat?ctx=customs", "海关数据", IconBuildingWarehouse],
      ],
    },
    {
      label: "销售转化",
      links: [
        ["/customers", "客户管理", IconUsers],
        ["/orders", "订单", IconReceipt],
        ["/documents", "文档库", IconFolder],
        ["/chat?ctx=docgen", "文档生成", IconFileText],
      ],
    },
    {
      label: "关税风险",
      links: [
        ["/tariff", "关税工作台", IconMessageChatbot],
        ["/tariff/inbox", "风险收件箱", IconInbox],
        ["/tariff/brief", "政策日报", IconNews],
        ["/tariff/knowledge", "知识库", IconBook],
        ["/tariff/review", "规则审核", IconFileSearch],
        ["/tariff/pipeline", "智能体流水线", IconGitMerge],
      ],
    },
    {
      label: "工具",
      links: [
        ["/research", "客户背调", IconUserSearch],
        ["/tasks", "定时任务", IconClock],
        ["/history", "对话记录", IconHistory],
      ],
    },
  ] as const;
  const isActive = (href: string) =>
    href.includes("?")
      ? pathname === "/chat" && params.get("ctx") === href.split("ctx=")[1]
      : pathname === href;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-org">
          <button className="org-button" onClick={() => setCompanyMenu(!companyMenu)}>
            <Image className="org-logo" src={BRAND.logo} alt={BRAND.name} width={26} height={26} />
            <span>{company.data?.name || BRAND.name}</span>
            <IconChevronDown size={16} />
          </button>
          {companyMenu && (
            <div className="popover">
              {companies.data?.map((c) => (
                <button
                  key={c.id}
                  className="menu-item"
                  onClick={() =>
                    action.run(
                      () => tradeApi(`/companies/${c.id}/select`, jsonBody("POST")),
                      "",
                      () => {
                        cache.clear();
                        location.reload();
                      },
                      false,
                    )
                  }
                >
                  {c.id === company.data?.id ? "• " : ""}
                  {c.name}
                </button>
              ))}
              <button
                className="menu-item"
                onClick={() => {
                  setCompanyMenu(false);
                  setDialog("company");
                }}
              >
                {t("添加公司")}
              </button>
              <Link className="menu-item" href="/settings?tab=company">
                {t("公司资料")}
              </Link>
            </div>
          )}
        </div>
        <div className="topbar-main">
          {tariff && (
            <div className="project-picker">
              <span className="project-mark">
                <IconFileText />
              </span>
              {t("税则 {hts_release}", { hts_release: meta?.hts_release || "—" })}
            </div>
          )}
          <h1 className="topbar-title">{title}</h1>
          <span className="topbar-clock">
            {t("北京时间")} {time || "—"}
          </span>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <nav className="nav-list" ref={navRef}>
            {sections.map((section) => (
              <div key={section.label}>
                <div className="nav-section-title">{t(section.label)}</div>
                {section.links.map(([href, label, Icon]) => (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-item${isActive(href) ? " active" : ""}`}
                    aria-current={isActive(href) ? "page" : undefined}
                  >
                    <Icon size={16} />
                    <span>{t(label)}</span>
                    {meta && (href === "/tariff/inbox" || href === "/tariff/review") && (
                      <span className="nav-count">
                        {href === "/tariff/inbox" ? meta.counts.pending : meta.counts.drafts_pending}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            {meta && (
              <div className="today-card">
                <div className="today-label">{t("今日已处理")}</div>
                <div className="today-value">
                  {meta.today.processed}
                  <small>
                    / {meta.today.total} {t("单")}
                  </small>
                </div>
                <div className="stack-bar">
                  {(["adopted", "dismissed", "needs_detail"] as const).map((key, i) => (
                    <i
                      key={key}
                      style={{
                        width: `${meta.today.total ? (meta.today[key] / meta.today.total) * 100 : 0}%`,
                        background: `var(--color-${["good", "bad", "warn"][i]})`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <Link href="/settings" className={`nav-item${pathname === "/settings" ? " active" : ""}`}>
              <IconSettings size={16} />
              <span>{t("设置")}</span>
              <span className="nav-hint">{t(model.data?.has_key ? "已接入" : "未接入")}</span>
            </Link>
            <div className="sidebar-profile">
              <button className="profile-button" onClick={() => setProfile(!profile)}>
                <span className="profile-avatar">{me.data?.email[0].toUpperCase()}</span>
                <span className="profile-name">{me.data?.email}</span>
              </button>
              <div className="segmented mini">
                <button className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>
                  中
                </button>
                <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
                  EN
                </button>
              </div>
              {profile && (
                <div className="popover">
                  {[
                    ["skills", "技能目录"],
                    ["onboarding", "新手引导"],
                  ].map(([id, label]) => (
                    <button
                      className="menu-item"
                      key={id}
                      onClick={() => {
                        setDialog(id);
                        setProfile(false);
                      }}
                    >
                      {t(label)}
                    </button>
                  ))}
                  <button
                    className="menu-item"
                    onClick={() =>
                      action.run(
                        () => tradeApi("/logout", jsonBody("POST")),
                        "",
                        () => {
                          cache.clear();
                          location.href = "/login";
                        },
                        false,
                      )
                    }
                  >
                    {t("退出登录")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
        <main className="content">
          {actions && <div className="filter-row">{actions}</div>}
          {(metaQuery.error || status.error) && (
            <ErrorBanner
              error={(metaQuery.error || status.error)!}
              retry={() => (tariff ? metaQuery.refetch() : status.refetch())}
            />
          )}
          {children}
        </main>
      </div>
      {dialog === "company" && (
        <Modal title="添加公司" onClose={() => setDialog("")}>
          <form
            className="trade-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              void action.run(
                () => tradeApi("/companies", jsonBody("POST", { name })),
                "",
                () => {
                  cache.clear();
                  location.reload();
                },
                false,
              );
            }}
          >
            <Field label="公司名称">
              <input className="input" name="name" required maxLength={200} />
            </Field>
            <button className="btn btn-primary" disabled={action.busy}>
              {t("添加公司")}
            </button>
          </form>
        </Modal>
      )}
      {dialog === "skills" && (
        <Modal title="技能目录" onClose={() => setDialog("")} wide>
          <p>{t("全部 {n} 个业务技能", { n: skills.data?.length || 0 })}</p>
          <div className="form-grid">
            {skills.data?.map((v) => (
              <section className="card conversion-card" key={v.id}>
                <strong>{v.name}</strong>
                <p className="detail-copy hint">{v.description}</p>
              </section>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "onboarding" && (
        <Modal title="新手引导" onClose={() => setDialog("")}>
          <ol className="entry-list">
            <li>{t("完善公司资料，让 AI 了解你的产品和目标市场。")}</li>
            <li>{t("添加客户或导入 CSV，集中管理客户与订单。")}</li>
            <li>{t("配置模型后开始对话，按需开启关税风险分析。")}</li>
          </ol>
          <div className="toolbar">
            <button className="btn" onClick={() => setDialog("")}>
              {t("稍后")}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setDialog("");
                router.push("/chat?ctx=lead");
              }}
            >
              {t("开始客户开发")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Shell(props: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  projectLabel?: ReactNode;
}) {
  return (
    <Suspense>
      <ShellContent {...props} />
    </Suspense>
  );
}

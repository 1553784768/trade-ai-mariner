# Mariner bridge acceptance review / 融合验收记录

Date: 2026-11-01. Branch: `codex/mariner-bridge`.

## Scope / 范围

The host is `smart-trade-ai/login-demo/`, based on host commit `b59f90c98e4b0f36a1be2acc26853d329e79fbcf`. The source is the adjacent `astra-dev-spec/` checkout, used read-only. The unavailable E: drive locations in the supplied plan were replaced with these workspace paths. The user's latest instruction takes precedence: the entire interface uses Mariner v0.3, including business pages. No Smart Trade AI root application files were changed.

一个 FastAPI 服务同时提供 Next 静态前端、原业务 API 和按公司隔离的关税 API。客户、订单、报价单、文档、模板、背调、定时任务、业务对话、Hermes 工具、设置与 Mariner 全部页面已接入统一导航。业务和关税模型保持独立配置。

## Evidence / 已验证

- Backend before legacy cleanup: **150 passed**, including original engine golden parity, company/workspace isolation, encrypted model settings, audit, conversion validation, EUR currency handling, cancelled orders, retry after link persistence failure, and busy-chat consent rejection.
- Final cleanup regression: **149 passed** after removing the obsolete legacy static-assets test.
- Browser suite: **36 passed** (22 migrated Mariner cases + 14 integrated business cases). Includes complete two-item order conversion and customer links, shipping status sync, explicit tariff consent, streaming chat, stop/history, Hermes tools across client navigation, and desktop bounds at 1280 px.
- Unit tests: **15 passed / 4 files**, preserving the original JavaScript test cases in Vitest.
- `ruff check`, TypeScript, style constraints, Prettier, ESLint, and production export passed. ESLint reports two navigation warnings for intentional full reload on logout; no errors.
- PowerShell development smoke passed: backend and Next started on loopback and both process trees stopped correctly. The Bash scripts were written but not executed on Windows.
- Production smoke: `/`, `/login`, `/orders`, `/tariff/inbox` returned 200; `/dev/components`, the E2E-only endpoint, and `/static/app.js` returned 404. Next `notFound()` exports preserve HTTP 404 when served by FastAPI. Seven focused static-routing and authentication tests passed after this fix.
- Production login was opened using only FastAPI at `http://127.0.0.1:8017/`; no Node server was running. Fresh browser visits redirect to login.
- `web/src/app/globals.css`, `seed/engine/rules.json`, and `seed/golden/impacts.json` match the source byte for byte. Engine `core.py` matches after normalizing the package import from `app` to `mariner`.
- Seventeen `bridge-*.png` screenshots cover login, all main pages, the conversion dialog and streaming thinking state. The contact sheet covers the sixteen application screenshots; login is separate. Visual review confirmed the original Mariner token palette and restrained layout.

## Implementation decisions / 实现说明

- Tariff runtimes are lazy and scoped by workspace/company. Business page reads do not create tariff databases. Only existing tenant databases are scheduled at 07:30 Asia/Shanghai.
- Business chat tariff consent defaults off and logs `CHAT_ORDER_DATA_SENT` only after obtaining the conversation turn. Refused busy turns neither call the model nor add a tariff disclosure audit.
- Cross-database conversion is retryable, with source provenance in tariff orders allowing links to be repaired safely.
- Session responses that do not change session data no longer rewrite the cookie; this prevents a delayed response from restoring an old active company. Company switches avoid refetching old tariff queries before reloading.
- New tariff conversations guard against a concurrent latest-conversation redirect. Form selections whose options arrive asynchronously remain controlled, preserving the selected customer and task skill.
- The newer host Hermes SSE protocol was retained. The source plan's older JSON description was not used.
- Legacy `login-demo/static/` files and `tests_js/` files were removed after UI acceptance. Their utility tests now live in `web/src/lib/` and run in Vitest. `/original-static` remains for original shared assets.

## Limits / 暂未验证及已知限制

真实 DeepSeek、Tavily、Hermes 和外部背调服务没有用真实账号或付费 Key 验证。离线测试使用本地夹具与模拟服务，不消耗真实模型额度。当前预览使用关税 fixture 模式与固定日期 2026-10-31；需注册账号，业务聊天需另行配置模型。

业务聊天尚无 Mariner 工作台的数字守卫；图片识别需要视觉模型。后台返回的部分错误、用户内容与模型输出保留原语言。仅面向 1280px 及以上桌面布局。公司首次启用时同步建库和计算可能需要几秒。跨数据库关联保存失败时需重试。实时采集按启用的公司分别执行。

Python dependencies emit two upstream deprecation warnings. During browser teardown Windows Python 3.14 occasionally logs a connection-reset callback after the browser closes; all browser assertions passed. The scripts do not suppress these diagnostics.

No unresolved product questions remain. User subsequently requested a new GitHub project. Authenticated account is `1553784768`; the abbreviated `1553784` returns 404. Publishing is authorized to a new private repository, `1553784768/trade-ai-mariner`. No email or other external messaging was performed.

## Publication correction / 发布入口修正（2026-11-01）

The user confirmed that the mismatch was between GitHub's repository homepage screenshots and the actual application. The repository initially retained the upstream root READMEs, which embedded legacy `docs/screenshot-*.png` images and instructed users to launch root `server.py`. This was a documentation publishing error, not a mismatch in the uploaded application code.

Verified remote main `d5594a96ce25d260f8290a722cf71946b78ba5c9` against local HEAD. Backend entry, Mariner CSS, integration CSS, shell, dependency lockfile and inbox screenshot Git blob hashes matched. The active loopback service runs `login-demo/.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8017`; its login response matches the local exported HTML byte for byte.

Both root READMEs now identify the integrated entry point and embed the verified `bridge-*` screenshots, explicitly labelling their fixture data and language. Application code was not changed. Repository visibility is public following the user's explicit request; the earlier private-publication note describes its initial creation only.

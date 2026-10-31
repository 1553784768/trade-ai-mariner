# Mariner 关税模块桥接到 Trade AI（login-demo）实施方案

> **给执行者（gpt-6.1-sol）**：本文件是唯一的任务说明，读完即可开工，不需要再问背景。两个仓库都在本机：
>
> - **宿主（下称 ST）**：`E:\黑客松物料\smart-trade-ai-main`，只改其中的 `login-demo/`（以及本文件所在的 `docs/`）。
> - **来源（下称 MA）**：`E:\黑客松物料\mariner-ai-codex-mariner-ai-preview\astra-dev-spec`，**只读，不要修改**。
>
> 路径写法：下文 `login-demo/...` 都相对 ST 根目录；`MA:...` 相对 MA 的 `astra-dev-spec/`。
> 命令默认在 Windows PowerShell 中执行。

---

## 0. 先读这一节

### 0.1 目标

把 MA 的全部功能并入 ST 的 `login-demo/`，得到**一个应用**：一个 FastAPI 进程，加一个 Next.js 前端。具体要求：

1. **功能完整**：MA 的关税影响引擎、风险收件箱、政策采集流水线、规则审核、政策日报、知识库、关税对话与多模态订单导入、模型接入、审计链，在新应用里全部可用。ST 旧界面的全部功能也不能丢。
2. **页面风格统一**：整站（包括 ST 原有页面）统一为 MA v0.3 的视觉和布局，并遵守任务 4.7 的“少色、简约”约束。
3. **数据深度打通**：ST 的订单可以一键生成关税订单；客户和订单详情显示关税风险；收件箱可以设置关联客户；ST 对话在用户开启开关后可以引用关税数据；侧栏显示关税计数。

### 0.2 已与用户确认的决策（不得改变）

| # | 决策 |
|---|---|
| U1 | 宿主是 ST 的 `login-demo/`（多账号、多公司版）。根目录原版应用（`server.py`、`trade/`、`static/trade_chat.*`）**不改**。 |
| U2 | **前端全部迁到 Next.js**。以 MA 的 `frontend/` 为基础，把 ST 现有页面全部用 React 重写进来。ST 旧的原生 JS 前端在阶段 9 验收通过后删除。 |
| U3 | 视觉采用 **MA v0.3 原色**，`MA:design/tokens-v03.css` 的数值一律不改。用户补充：**“颜色不宜过多、简约（参考 Claude）”**，落地规则见任务 4.7。 |
| U4 | 关税模块的大模型**单独配置**（OpenAI 兼容接口，可填任意 base_url），与 ST 的 DeepSeek 对话模型互不影响。密钥必须加密保存。 |
| U5 | **深度打通**，范围见 §0.1 第 3 条，细节见阶段 2 和阶段 7。 |

### 0.3 默认决策（已替用户定好，照做即可）

| # | 默认决策 |
|---|---|
| D1 | 关税数据**按公司隔离**：每个 `(workspace_id, company_id)` 用一个独立的 SQLite 文件，位置是 `login-demo/data/tariff/w{workspace_id}/c{company_id}.sqlite3`。 |
| D2 | 关税模型配置**按账号空间保存**：每个 workspace 一份，所有公司共用。放在 ST 主库的新表 `tariff_model_settings` 中，API Key 用 ST 的 `SecretStore` 加密。 |
| D3 | 产品名保持 **Trade AI**；关税模块在导航里叫“关税风险”；Logo 用 ST 根目录下的 `static/trade-icon.png`（不在 `login-demo/` 里）。产品名、Logo 和版本号集中写在 `web/src/lib/brand.ts`，以后改一处即可。 |
| D4 | 保留 MA 的 **中 / EN** 切换，整站生效。所有新增界面文案都要同时写 zh 和 en。ST 后端返回的中文错误信息不翻译，这是已知限制。 |
| D5 | 某个公司首次进入任意关税页面（或首次生成关税订单）时，按 MA 原逻辑导入种子规则和示例订单 O1–O8，这就算“启用”了关税模块。只是浏览 ST 的其他页面不会启用（见任务 2.1 的“启用”规则）。示例订单可以用环境变量 `TARIFF_SEED_SAMPLE_ORDERS` 关闭，默认 `1`（开启）。 |
| D6 | 采集模式默认 `live`。离线演示用 `TARIFF_COLLECTOR_MODE=fixture` 加 `TARIFF_AS_OF_DATE=2026-10-31`。每天北京时间 07:30，对**已有关税库文件的公司**依次运行一次流水线。 |
| D7 | ST 对话引用关税数据，算作“订单数据外发”。开关**默认关闭**，用户手动打开后才发送，并且每次都写入该公司的关税审计链，动作沿用 MA 的 `CHAT_ORDER_DATA_SENT`。 |
| D8 | 只做桌面端，最小宽度 1280px（MA 规则）。ST 旧版的移动端布局不再保留。 |
| D9 | ST 后端已有、但旧界面没有入口的能力，在新界面补上入口：单证模板（`/api/templates*`）、业务记忆（`/api/memory`）、删除文档、删除背调报告、删除定时任务、任务启停、删除订单。 |
| D10 | MA 原来的 Host 白名单校验不再保留，因为应用只监听 127.0.0.1，而开发代理会改写 Host。Origin 校验改到 ST 主应用层，规则见阶段 1 任务 1.9。 |

### 0.4 硬性约束

1. **租户隔离**：所有新接口一律通过 `tenancy.require_tenant(request)` 拿到 user、workspace 和 company；不接受客户端传来的 `user_id`、`workspace_id`、`company_id`；跨空间访问一律返回 404。
2. **关税数字只由 MA 引擎计算**，引擎代码在 `login-demo/mariner/engine/`。不改 `core.py` 里的算式、阈值和文案，不改 `rules.json` 里的税率和日期，golden 测试（`seed/golden/impacts.json`）必须一直通过。前端只做格式化，以及 `MA:docs/V03_DESIGN.md` §9.4 列出的显示用计数。
3. **订单数据外发**只允许三种情况：MA 原有的两种（工作台“对话可使用订单数据”开关、导入确认弹窗），加本方案新增的 D7。三种情况都必须写审计。
4. 自动化测试**不联网**：后端用 MA 的 fixtures 和 `httpx.MockTransport`；E2E 用本地模拟模型。
5. 服务只监听 `127.0.0.1`。
6. 不修改 MA 仓库，也不修改 ST 根目录的原版应用。
7. 代码、注释和提交信息用英文；界面文案以中文为主，并提供英文。
8. **Next.js 16 有破坏性变化**：写前端代码前，先读 `login-demo/web/node_modules/next/dist/docs/` 中这几篇指南：static export（`output: 'export'`）、`rewrites`、`useSearchParams` 与 `Suspense`、`next/image` 的 `unoptimized`。以那里的说法为准，不要凭记忆写。
9. MA 是 MIT 许可、ST 是 AGPL-3.0。从 MA 复制过来的代码要保留 MIT 声明：把 `MA:../LICENSE` 复制为 `login-demo/mariner/LICENSE-MARINER` 和 `login-demo/web/LICENSE-MARINER`。

### 0.5 遇到不确定的事怎么办

1. 按这个顺序查：本文件 → MA 文档（优先级 `V03_DESIGN > V021_SPEC > V02_SPEC > SPEC > API > AI_PIPELINE > DESIGN`）→ ST 代码的现有行为。
2. 如果还是不确定，而且会影响界面、接口、数据、安全或依赖：在 `docs/superpowers/questions/2026-11-01-mariner-bridge.md` 追加一条 `Q-xxx`，写清问题、可选方案和你的推荐。代码里写 `BLOCKED(Q-xxx)`，界面上需要占位的地方显示“待定”，然后跳过、继续做其他任务，最后在汇报中列出全部 Q。
3. 内部命名、文件拆分、组件结构、测试辅助代码、不改变外部行为的重构，可以自己决定。

### 0.6 工作方式

- 如果 ST 是 git 仓库：新建分支 `feat/mariner-bridge`，每完成一个阶段提交一次（英文提交信息）。
- **严格按阶段顺序推进**。每个阶段末尾都有“完成标准”，全部满足才进入下一阶段。
- 每个阶段完成后，在本文件末尾的“进度”一节勾选，并写一行说明（日期 + 结果 + 测试数）。
- 后端检查：在 `login-demo/` 下运行 `python -m pytest tests -q`。前端检查：在 `login-demo/web/` 下运行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build:export`；涉及界面的阶段再跑 `npx playwright test`。

---

## 1. 现状速览（动手前必须知道的事实）

### 1.1 ST `login-demo/`

- **入口**：`login-demo/app.py` 中的 `create_app(db_path=None, secret_key=None, *, model_transport=None, skill_dir=None, osint_runner=None, hermes_runner=None)`，模块末尾有 `app = create_app()`。启动命令：`python -m uvicorn app:app --host 127.0.0.1 --port 8017`（在 `login-demo/` 目录下）。
- **所有模块都是平铺的顶层模块**（如 `from database import connection`），没有包。⚠️ **`app.py` 与 MA 的 `app/` 包同名**，所以 MA 后端复制过来后必须改名为 `mariner` 包。
- **数据库**：`login-demo/data/accounts.sqlite3`，用标准库 `sqlite3` 手写 SQL；`database.migrate(path)` 负责幂等迁移；业务表的 DDL 在 `operations_schema.py` 和 `platform_schema.py` 的 `TABLES` 列表里。
- **加密**：`secret_store.SecretStore(data/model-encryption.key)`，接口是 `encrypt(workspace_id, text)` 和 `decrypt(workspace_id, ciphertext)`；密文和 workspace 绑定，解密失败时抛 `ValueError`。
- **会话与租户**：Starlette `SessionMiddleware`（cookie 名 `login_demo_session`，SameSite=Lax）。`tenancy.require_tenant(request)` 返回 `TenantContext(user_id, workspace_id, email, company_id)`；`company_id` 取自 session 里的 `active_company_id`，切换公司时由 `POST /api/companies/{id}/select` 写入。`require_tenant` 内部用的是 `request.app.state.db_path`。
- **错误格式**：业务错误是 `{"detail": "..."}`（HTTPException）；校验错误是 422 `{"detail": [...]}`。
- **后台任务**：lifespan 中启动 `automation_api.scheduler_loop`，每 30 秒检查一次到期的定时任务。
- **对话**：`chat_api.py`。`POST /api/conversations/{cid}/stream` 返回 SSE，事件有 `start/sources/reasoning/tool/delta/done/error`；`POST /api/conversations/{cid}/hermes` 返回 JSON。模型调用在 `model_gateway.py`，固定访问 `https://api.deepseek.com/chat/completions`。
- **旧前端**：登录页是 `static/index.html` + `app.js` + `app.css`；工作台是 `static/workspace.html` + `workspace.js` + `workspace.css`，并依赖 `/original-static/trade_chat.css`；工具模块有 `static/api.js`、`sse.js`、`chat-state.js`、`thinking.js`；JS 测试在 `tests_js/*.test.js`（node:test）。**旧界面的每个功能都要在新前端里实现**，清单见附录 B.1。
- **测试**：在 `login-demo/` 下运行 `python -m pytest tests -q`。`tests/browser_fixture.py` 是一个带模拟模型的手动浏览器服务器，写 E2E 后端时照着它做。
- 全部 HTTP 接口见附录 A.1。

### 1.2 MA

- **后端**：`MA:backend/app` 包（FastAPI + SQLAlchemy 2 + SQLite + APScheduler），入口 `app/main.py::create_app(settings)`。所有表都是 `id / business_date / payload(JSON)` 结构的记录，定义在 `db/models.py`。
- **单用户假设**：
  - `session.get(LlmSettings, "local")` 存模型配置，API Key 是**明文**。用到它的地方有：`pipeline/orchestrator.py::run_agent`、`api/chat.py::send`、`api/import_jobs.py::create/consent`、`api/model_settings.py` 全部接口、`api/routes.py::meta`。
  - `request.app.state.factory / settings / pipeline` 是全局单例。
- **资源路径**：`app/settings.py` 中 `ROOT = Path(__file__).parents[2]`（即 `astra-dev-spec/`），`FIXTURES = ROOT/"backend"/"fixtures"`。引用 ROOT 的地方：
  - `db/store.py`：`seed/engine/rules.json`、`seed/engine/orders_sample.csv`
  - `engine/i18n.py`：`docs/engine_text_templates.json`
  - `api/chat.py`：`backend/app/agents/prompts/chat_v2.md`
  - `api/import_jobs.py`：`backend/app/agents/prompts/import_v1.md`
  - `orchestrator.py` 用 `Path(__file__).parents[1]/"agents/prompts"`，与 ROOT 无关。
- **错误格式**：`{"error": {"code", "message", "details?"}}`，校验错误返回 **400**（见 `api/errors.py`）。
- **中间件**：TrustedHost、本地 Host/Origin 校验、CORS（见 `main.py`）。
- **前端**：Next 16.4 + React 19.3 + React Query 5 + `@tabler/icons-react` + Tailwind 4（只用 `@theme` 令牌和自定义类，类名定义在 `src/app/globals.css`）。
  - API 调用：`src/lib/api.ts` 拼成 `${API_BASE}/api${path}?lang=`。
  - 多语言：`t("中文键")`，`src/i18n/en.ts` 提供英文，缺翻译时显示中文键。
  - 页面：`/` 工作台、`/inbox`、`/brief`、`/knowledge`（与 `/kb` 相同）、`/review`、`/pipeline`、`/settings`、`/dev/components`。
- **测试**：44 项 pytest（`backend/tests`，用到 `respx`）；22 项 Playwright（`frontend/e2e`，后端端口 8001、前端端口 3001）。
- **规格文档**：都在 `MA:docs/`。页面行为以 `V03_DESIGN.md` §6 为准，知识库、对话、导入、多语言以 `V02_SPEC.md` / `V021_SPEC.md` 为准，接口以 `API.md` 为准。

---

## 2. 目标架构

### 2.1 运行形态

```
浏览器 ──同源──▶ FastAPI  login-demo/app.py  (127.0.0.1:8017)
                 ├─ /api/tariff/*        Mount：MA 子应用（mariner 包）；按当前公司选库
                 ├─ /api/trade-tariff/*  新增：ST↔MA 打通接口（ST 风格错误格式）
                 ├─ /api/*               ST 原有接口（行为不变；chat 增加 include_tariff）
                 ├─ /original-static/*   保留
                 └─ /*                   Next.js 静态导出 login-demo/web/out（SPA 回退）

开发模式：next dev (127.0.0.1:3000) ──rewrites /api/* ──▶ FastAPI 127.0.0.1:8017
生产/演示：npm run build:export 后，只需启动 FastAPI，打开 http://127.0.0.1:8017/
```

### 2.2 完成后的目录结构

```
login-demo/
  app.py                    改：挂载 tariff 子应用、lifespan 管理、静态前端、Origin 校验
  database.py               改：migrate() 执行 tariff_schema.TABLES
  tariff_schema.py          新：tariff_model_settings、tariff_order_links 两张表及触发器
  tariff_runtime.py         新：TariffRegistry、WorkspaceLlmStore、run_scheduled
  tariff_bridge_api.py      新：/api/trade-tariff/* 打通接口
  tariff_context.py         新：生成 ST 对话用的关税摘要并写审计
  spa_files.py              新：静态导出的 SPA 文件服务
  chat_api.py               改：ChatInput.include_tariff
  requirements.txt          改：新增依赖（阶段 1 任务 1.1）
  requirements-dev.txt      改：新增 respx、ruff
  mariner/                  新：由 MA backend/app 复制改造而来
    __init__.py  settings.py  runtime.py(新)  llm_store.py(新)  factory.py(新)
    localization.py  scheduler.py
    agents/（含 prompts/*.md） api/ audit/ collectors/ db/ engine/ knowledge/ pipeline/
    resources/              见任务 1.2：保持 MA 原目录形状，让 ROOT 相对路径不变
    LICENSE-MARINER
  tests/
    conftest.py             改：设置 TARIFF_* 测试环境变量
    tariff/                 新：MA 的 44 项测试（迁移）+ 本方案新增的集成测试
    e2e_server.py           新：Playwright 用的后端
  web/                      新：Next.js 前端（由 MA frontend 改造）
  scripts/dev.ps1, dev.sh   新：一键启动后端和前端开发服务器
  static/                   阶段 9 整个删除（里面全是旧前端文件），同时去掉 /static 挂载
  tests_js/, package.json   阶段 9 删除（测试已迁到 web 的 vitest）
```

### 2.3 URL 对照

| 旧位置 | 新位置 |
|---|---|
| ST `/`（登录） | `/login` |
| ST `/trade` 今日简报 | `/`（今日简报对话）。`/trade` 重定向到 `/` |
| ST 其余对话入口（客户开发、网站诊断、社媒营销、LinkedIn、海关数据、文档生成、文档库问答） | `/chat?ctx=lead\|platform\|social\|linkedin\|customs\|docgen\|docs` |
| ST 客户管理 | `/customers`（`?id=&tab=`） |
| ST 订单（原在客户详情弹窗里） | `/orders`（`?id=&tab=`）新页面；客户详情仍保留订单标签页 |
| ST 文档库 | `/documents`（`?lib=&doc=`；模板模式 `?mode=templates&tpl=`） |
| ST 客户背调 | `/research`（`?id=`） |
| ST 定时任务 | `/tasks`（`?id=`） |
| ST 对话记录 | `/history`（`?id=`） |
| ST 模型设置、公司设置、搜索配置 | `/settings?tab=chat\|tariff\|search\|company\|memory\|account` |
| MA `/` 工作台 | `/tariff`（`?c=`） |
| MA `/inbox`、`/brief`、`/knowledge`（`/kb`）、`/review`、`/pipeline` | `/tariff/inbox`、`/tariff/brief`、`/tariff/knowledge`（`/tariff/kb`）、`/tariff/review`、`/tariff/pipeline`，查询参数不变 |
| MA `/settings` | `/settings?tab=tariff`；`/tariff/settings` 客户端重定向过去 |
| MA `/dev/components` | `/dev/components`（生产构建返回 404，与 MA 相同） |
| MA 接口 `/api/<x>` | `/api/tariff/<x>`（例如 `/api/meta` → `/api/tariff/meta`） |

---

## 3. 阶段总览

| 阶段 | 内容 | 主要产出 |
|---|---|---|
| 1 | 后端：MA 迁入为 `mariner` 包，多租户运行时，挂载到 `/api/tariff` | `mariner/`、`tariff_runtime.py`、`tariff_schema.py`、改 `app.py`；MA 44 项测试通过 |
| 2 | 后端：深度打通接口和对话引用 | `tariff_bridge_api.py`、`tariff_context.py`、改 `chat_api.py` |
| 3 | 后端：伺服 Next 静态导出，切换入口路由 | `spa_files.py`、改 `app.py` 和 `tests/test_app.py` |
| 4 | 前端地基：`web/` 工程、API 客户端、登录守卫、整站外壳、设计约束 | `web/` 可构建，登录后看到新外壳 |
| 5 | 前端：MA 七个页面迁到 `/tariff/*` | 关税页面在新外壳中全部可用 |
| 6 | 前端：ST 全部页面用 React 重写 | 附录 B.1 的功能清单全部打勾 |
| 7 | 前端：深度打通界面 | 生成关税订单、客户/订单关税风险、收件箱关联客户、对话开关、今日简报卡片 |
| 8 | 测试与验收：vitest、Playwright（MA 22 项迁移 + 新增）、截图 | 全部检查通过 |
| 9 | 收尾：删除旧前端、脚本、README、进度记录 | 交付 |

---

## 4. 阶段 1：后端，把 MA 迁入为 `mariner` 包

### 任务 1.1 依赖

`login-demo/requirements.txt` 追加以下依赖（保持文件原有的“下限,上限”写法）：

```
pydantic-settings>=2.4,<3.0
SQLAlchemy>=2.0.30,<3.0
APScheduler>=3.10,<4.0
pdfplumber>=0.11,<1.0
tzdata>=2024.1
```

`requirements-dev.txt` 追加：`respx>=0.21,<1.0`、`ruff>=0.6`。

Python 版本要求提升到 **3.12+**，因为 MA 代码以 3.12 为目标。README 在阶段 9 更新。

新建 `login-demo/ruff.toml`，只检查 MA 迁来的代码：

```toml
target-version = "py312"
line-length = 110
include = ["mariner/**/*.py", "tests/tariff/**/*.py", "tariff_*.py", "spa_files.py"]
extend-exclude = ["mariner/resources"]   # MA seed engine.py is reference code (E741)
[lint]
select = ["E4", "E7", "E9", "F"]
[lint.per-file-ignores]
"mariner/engine/core.py" = ["E741"]
```

后续改动会留下一些不再使用的导入，ruff 会报 F401，全部删掉即可。已知的有：`api/chat.py` 和 `api/import_jobs.py` 中的 `ROOT`、`api/model_settings.py` 中的 `LlmSettings`、`api/pipeline_routes.py` 中的 `Request`、`tests/tariff/test_v021.py` 中的 `ROOT`。

### 任务 1.2 复制代码与资源

1. 把 `MA:backend/app/` **整个**复制为 `login-demo/mariner/`，`__pycache__` 除外。复制后删除 `mariner/main.py`，它的功能由任务 1.7 的 `factory.py` 接替。
2. 新建 `login-demo/mariner/resources/`，**保持 MA 原来的目录形状**。这样 `ROOT / "seed/..."` 这类相对路径一行都不用改：
   ```
   mariner/resources/seed/engine/{engine.py, rules.json, orders_sample.csv}     ← MA:seed/engine/
   mariner/resources/seed/golden/impacts.json                                   ← MA:seed/golden/
   mariner/resources/docs/engine_text_templates.json                            ← MA:docs/engine_text_templates.json
   mariner/resources/backend/fixtures/{federal_register,usitc,llm,import}/ 和 README.md  ← MA:backend/fixtures/（不要复制 fonts/）
   ```
3. 改导入：把 `mariner/` 下所有 `.py` 中的 `from app.` 改成 `from mariner.`，`from app import` 改成 `from mariner import`。完成后在 `login-demo/mariner` 下运行 `rg -n "from app\b|import app\b"`，结果必须为空。
   ⚠️ 只改 `mariner/` 目录里的文件。ST 自己的 `from app import create_app`（在 `tests/` 里）是 ST 的 `app.py`，**不要动**。
4. 把 `MA:../LICENSE` 复制为 `login-demo/mariner/LICENSE-MARINER`。

### 任务 1.3 `mariner/settings.py`

整体替换为下面的内容。字段名必须与 MA 一致，因为迁移过来的测试会用关键字参数构造 `Settings(...)`。

```python
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE / "resources"                 # mirrors MA astra-dev-spec/ for seed/, docs/, backend/fixtures/
FIXTURES = ROOT / "backend" / "fixtures"
PROMPTS = PACKAGE / "agents" / "prompts"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TARIFF_", extra="ignore")
    database_url: str = "sqlite:///./data/tariff-standalone.db"  # standalone/tests only
    timezone: str = "Asia/Shanghai"
    as_of_date: date | None = None
    collector_mode: str = "live"          # live | fixture
    scheduler_enabled: bool = True
    seed_sample_orders: bool = True

    @property
    def today(self):
        return self.as_of_date or datetime.now(ZoneInfo(self.timezone)).date()


def now():
    return datetime.now(ZoneInfo("Asia/Shanghai")).isoformat()
```

然后修改两处提示词路径：`mariner/api/chat.py` 中的 `ROOT / "backend/app/agents/prompts/chat_v2.md"` 改为 `PROMPTS / "chat_v2.md"`；`mariner/api/import_jobs.py` 中的 `import_v1.md` 同样改为 `PROMPTS / "import_v1.md"`。

### 任务 1.4 模型配置存储抽象（落实 U4、D2）

新建 `mariner/llm_store.py`：

```python
from typing import Protocol


class LlmStore(Protocol):
    def get(self) -> dict | None: ...
    # -> {"base_url","model","api_key","last_test"}; the plaintext key lives only in memory
    def save(self, *, base_url: str, model: str, api_key: str) -> dict: ...  # resets last_test to None
    def clear(self) -> None: ...
    def record_test(self, result: dict) -> None: ...  # {"ok","message","latency_ms","at"}


class MemoryLlmStore:
    """Single-process store for the standalone app and the ported MA tests."""
    def __init__(self):
        self._value = None
    def get(self):
        return None if self._value is None else dict(self._value)
    def save(self, *, base_url, model, api_key):
        self._value = dict(base_url=base_url, model=model, api_key=api_key, last_test=None)
        return self.get()
    def clear(self):
        self._value = None
    def record_test(self, result):
        if self._value is not None:
            self._value["last_test"] = result
```

把所有 `session.get(m.LlmSettings, "local")` 和 `session.get(LlmSettings, "local")` 都换成 `llm.get()`。改完后 `rg -n "LlmSettings, \"local\"" mariner` 结果必须为空。`llm` 的来源见任务 1.6；`Pipeline` 内部用 `self.llm`。

| 文件 | 改法 |
|---|---|
| `pipeline/orchestrator.py` | `Pipeline.__init__(self, factory, settings, llm)` 保存 `self.llm`；`run_agent` 里改为 `config = self.llm.get(); client = HttpLLMClient(config) if config else FixtureLLMClient()` |
| `api/chat.py::send` | 增加参数 `llm=Depends(llm_dep)`；`config = llm.get()`；`config.payload["model"]` 改为 `config["model"]`；`HttpLLMClient(config.payload)` 改为 `HttpLLMClient(config)` |
| `api/import_jobs.py::create`、`consent` | 同上 |
| `api/routes.py::meta` | 增加 `llm=Depends(llm_dep)`；`llm_configured = llm.get() is not None` |
| `api/model_settings.py` | 全部改用 `llm`，规则见下方 |

`api/model_settings.py` 的改法：

- `public_settings(value: dict | None, lang)` 改成接收 dict。`api_key_masked = "****" + value["api_key"][-4:]`。
- `PUT`：`key = body.api_key if body.api_key is not None else (current["api_key"] if (current := llm.get()) else None)`。URL 等校验规则与 MA 原来完全一致。通过后调用 `llm.save(base_url=body.base_url.rstrip("/"), model=body.model, api_key=key)`，写审计 `LLM_SETTINGS_CHANGED`，然后 `session.commit()`。
- `DELETE`：调用 `llm.clear()`，写审计。
- `POST /test`：未配置时返回 400，与 MA 相同；测试结果用 `llm.record_test({...value, "at": now()})` 保存。

`db/models.py` 中的 `LlmSettings` 类保留，但不再使用，以免旧库建表时报错。

### 任务 1.5 运行时：`mariner/runtime.py`（新建）

```python
from dataclasses import dataclass
from datetime import datetime, timedelta

from mariner.db.models import ImportJob
from mariner.db.store import database, rows, seed
from mariner.engine.service import create_run
from mariner.pipeline.orchestrator import Pipeline
from mariner.settings import now


@dataclass
class TariffRuntime:
    settings: object
    engine: object
    factory: object
    pipeline: Pipeline
    llm: object

    def close(self):
        self.pipeline.close()
        self.engine.dispose()


def open_runtime(settings, database_url, llm) -> TariffRuntime:
    engine, factory = database(database_url)
    with factory.begin() as session:
        seed(session, str(settings.today), sample_orders=settings.seed_sample_orders)
        create_run(session, settings)
        cutoff = datetime.fromisoformat(now()) - timedelta(days=7)
        for job in rows(session, ImportJob):          # moved from MA main.lifespan
            created = job.payload.get("created_at")
            if created and datetime.fromisoformat(created) < cutoff:
                session.delete(job)
    return TariffRuntime(settings, engine, factory, Pipeline(factory, settings, llm), llm)
```

同时给 `mariner/db/store.py::seed` 加参数 `sample_orders: bool = True`，只有为 True 时才导入 `orders_sample.csv`。规则种子总是导入。

### 任务 1.6 路由前缀、依赖和错误码

1. 去掉路由前缀里的 `/api`。子应用挂载在 `/api/tariff`，所以路由本身不再带 `/api`：

   | 文件 | 原 prefix | 新 prefix |
   |---|---|---|
   | `api/routes.py` | `/api` | `""` |
   | `api/pipeline_routes.py` | `/api` | `""` |
   | `api/model_settings.py` | `/api/settings/llm` | `/settings/llm` |
   | `api/knowledge.py` | `/api/kb` | `/kb` |
   | `api/chat.py` | `/api/chat/conversations` | `/chat/conversations` |
   | `api/import_jobs.py` | `/api/import-jobs` | `/import-jobs` |

2. 在 `api/routes.py` 中重写依赖。函数名保持不变，因为其他文件和测试会 `from mariner.api.routes import session_dep, settings_dep`：

   ```python
   def runtime_dep(request: Request):
       return request.app.state.resolve_runtime(request)

   def session_dep(runtime=Depends(runtime_dep)):
       with runtime.factory() as session:
           try:
               yield session
               session.commit()
           except Exception:
               session.rollback()
               raise

   def settings_dep(runtime=Depends(runtime_dep)):
       return runtime.settings

   def pipeline_dep(runtime=Depends(runtime_dep)):
       return runtime.pipeline

   def llm_dep(runtime=Depends(runtime_dep)):
       return runtime.llm
   ```

3. `api/pipeline_routes.py`：把 `request.app.state.pipeline.start()` 改为注入 `pipeline=Depends(pipeline_dep)` 后调用 `pipeline.start()`。
4. `api/errors.py::http_error`：
   - 错误码改为 `{401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT"}.get(status, "BAD_REQUEST")`。
   - 状态为 401 时，message 固定为 `登录已过期，请重新登录。`，并在 `mariner/localization.py` 的 `TEXT` 字典中加入对应英文 `Session expired. Please sign in again.`。
   - 原来的 `http_error` 不做翻译，所以要照 `api_error` 的写法补上：当 `request.query_params.get("lang") == "en"` 时，对 message 调用 `translate()`。

### 任务 1.7 子应用工厂：`mariner/factory.py`（新建）

```python
MARINER_VERSION = "0.3.0"
ROUTERS = [routes.router, model_settings.router, pipeline_routes.router,
           knowledge.router, chat.router, import_jobs.router]


def create_tariff_app(resolve_runtime, *, prefix: str = "") -> FastAPI:
    app = FastAPI(title="Mariner AI (Trade AI tariff module)", version=MARINER_VERSION)
    app.state.resolve_runtime = resolve_runtime
    register_errors(app)
    for router in ROUTERS:
        app.include_router(router, prefix=prefix)

    @app.get(f"{prefix}/health")
    def health():
        return {"status": "ok"}

    install_openapi(app)  # copy the custom openapi() from MA main.py unchanged
    return app


def create_standalone_app(settings: Settings | None = None) -> FastAPI:
    """Single-tenant app used ONLY by the ported MA tests and local debugging."""
    settings = settings or Settings()
    runtime = open_runtime(settings, settings.database_url, MemoryLlmStore())
    app = create_tariff_app(lambda request: runtime, prefix="/api/tariff")
    app.state.runtime = runtime
    app.state.factory = runtime.factory      # the ported tests use these three names
    app.state.settings = settings
    app.state.pipeline = runtime.pipeline
    scheduler = make_scheduler(settings, runtime.pipeline)

    @asynccontextmanager
    async def lifespan(_app):
        if settings.scheduler_enabled:
            scheduler.start()
        try:
            yield
        finally:
            if scheduler.running:
                scheduler.shutdown()
            runtime.close()

    app.router.lifespan_context = lifespan
    return app
```

不要把 MA 的 CORS、TrustedHost、`local_only` 中间件搬进来（D10）。

### 任务 1.8 ST 侧：表结构和多租户注册表

**新建 `login-demo/tariff_schema.py`**：

```python
TABLES = [
    """CREATE TABLE IF NOT EXISTS tariff_model_settings (
        workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        last_test TEXT NOT NULL DEFAULT 'null',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )""",
    """CREATE TABLE IF NOT EXISTS tariff_order_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL,
        tariff_order_id TEXT NOT NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        item_position INTEGER,               -- 0-based index into GET /api/orders/{id} items
        item_name TEXT NOT NULL DEFAULT '',  -- product_name at conversion time; used to detect stale links
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(workspace_id, company_id, tariff_order_id),
        FOREIGN KEY(company_id, workspace_id) REFERENCES companies(id, workspace_id) ON DELETE CASCADE
    )""",
    "CREATE INDEX IF NOT EXISTS idx_tariff_links_customer ON tariff_order_links(workspace_id, company_id, customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_tariff_links_order ON tariff_order_links(workspace_id, company_id, order_id)",
    # Two triggers, BEFORE INSERT and BEFORE UPDATE, with the same WHEN:
    #  (NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=NEW.customer_id
    #       AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id))
    #  OR (NEW.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id
    #       AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id))
    #  BEGIN SELECT RAISE(ABORT, 'Link target belongs to another company'); END
]
```

在 `database.migrate()` 中执行 `tariff_schema.TABLES`，要求幂等。位置放在 `ADD COLUMN company_id` 那个补列循环**之后**（`database.py` 约第 210–243 行），这样升级旧库时引用的列都已存在。

**新建 `login-demo/tariff_runtime.py`**，包含两部分：

1. `WorkspaceLlmStore(db_path, workspace_id, secret_store)`：实现 `LlmStore`，读写 `tariff_model_settings`。
   - `get()`：没有记录时返回 None。解密失败（`ValueError`）时记一条 warning 日志，然后返回 None，也就是当作“未接入”。
   - `save()` 用 `INSERT ... ON CONFLICT(workspace_id) DO UPDATE`；`last_test` 以 JSON 文本存储。
   - **明文 Key 绝不写入任何数据库**。
2. `TariffRegistry(db_path, data_dir, settings, secret_store)`：
   - `path_for(ws, company)` 返回 `data_dir / f"w{ws}" / f"c{company}.sqlite3"`。
   - `is_opened(ws, company)`：关税库文件是否已经存在。**这个方法不会创建库。**
   - `get(ws, company)`：在 `threading.Lock` 保护下检查缓存；没有则调用 `open_runtime(settings, "sqlite:///" + path.as_posix(), WorkspaceLlmStore(...))` 并放入缓存。**只有这个方法会创建关税库**，也就是“启用”该公司的关税模块。
   - `resolve(request)`：`tenant = require_tenant(request)`；`tenant.company_id is None` 时抛 `HTTPException(404, "Company not found")`；否则 `return self.get(tenant.workspace_id, tenant.company_id)`。
   - `existing_tenants()`：从 ST 主库 `SELECT id, workspace_id FROM companies`，只保留关税库文件已存在的组合。
   - `run_scheduled()`：对 `existing_tenants()` 中的每个组合依次调用 `self.get(ws, c).pipeline.start(trigger="schedule_0730", background=False)`。每个公司单独 try/except 并记日志，一家失败不影响下一家。
   - `close_all()`：关闭所有缓存的运行时。

### 任务 1.9 修改 `login-demo/app.py`

1. `create_app` 新增参数：`tariff_settings=None, tariff_data_dir=None, web_dir=None, allowed_origins=None, extra_routers=()`。
   - 默认值分别是：`mariner.settings.Settings()`（读取 `TARIFF_*` 环境变量）、`resolved_db_path.parent / "tariff"`、`APP_DIR / "web" / "out"`、环境变量 `TRADE_ALLOWED_ORIGINS`（缺省为 `http://127.0.0.1:3000,http://localhost:3000`）、空元组。
   - `extra_routers` 中的路由要在 `mount_spa` **之前** `include_router`。它只给 E2E 服务器挂测试辅助接口用，生产调用不传。
2. 先创建 `SecretStore`，再创建 `TariffRegistry`，挂到 `app.state.tariff_registry`。
3. 创建子应用：`tariff_app = create_tariff_app(registry.resolve)`；设置 `tariff_app.state.db_path = resolved_db_path`，因为子应用里的 `require_tenant` 读的是 `request.app.state.db_path`。然后执行 `app.mount("/api/tariff", tariff_app)`。**这一步要放在所有 `include_router` 之前。**
4. lifespan 中，除原有的 `scheduler_loop` 外：
   - `tariff_settings.scheduler_enabled` 为真时，启动 `BackgroundScheduler(timezone="Asia/Shanghai")`，添加任务 `registry.run_scheduled`，触发器 `CronTrigger(hour=7, minute=30, timezone="Asia/Shanghai")`，参数 `id="tariff-daily-pipeline", max_instances=1, coalesce=True`。
   - `finally` 中关闭这个调度器，并调用 `registry.close_all()`。
5. 增加 Origin 校验中间件（D10）。规则：对 `/api/` 开头且方法不是 GET、HEAD、OPTIONS 的请求，如果带了 `Origin` 头，并且这个值既不在 `allowed_origins` 里，也不等于 `f"{scheme}://{host}"`，就返回 403，响应体为 `{"detail": "请求来源不被允许", "error": {"code": "FORBIDDEN", "message": "请求来源不被允许"}}`（同时满足两种前端错误解析）。
6. 本阶段**先不动** `/`、`/trade` 和 `/static` 路由，阶段 3 再改。

### 任务 1.10 迁移 MA 的 44 项测试

1. 把 `MA:backend/tests/*.py` 复制到 `login-demo/tests/tariff/`，并新建空的 `__init__.py`。
2. `tests/tariff/conftest.py`：保留 MA 的 `no_network` fixture。`client` fixture 改为：
   `create_standalone_app(Settings(database_url=f"sqlite:///{tmp_path}/test.db", as_of_date="2026-10-31", collector_mode="fixture", scheduler_enabled=False))`，再用 `TestClient(app, base_url="http://127.0.0.1:8000")` 打开。
3. 批量替换：
   - 导入 `from app.` → `from mariner.`。
   - URL 中的 `"/api/` → `"/api/tariff/`，`'/api/` → `'/api/tariff/`，`f"/api/` → `f"/api/tariff/`，`f'/api/` → `f'/api/tariff/`。
   - `ROOT/'backend/app/agents/prompts/...'` → `PROMPTS/'...'`（test_v02 第 167 行、test_v021 第 69 行附近），并从 `mariner.settings` 导入 `PROMPTS`。
   - 其余 `ROOT / "seed/..."` 和 `ROOT/'backend/fixtures/...'` 都不用改，因为 resources 保持了原目录形状。
4. `test_foundation.py`：`create_app(...)` 改为 `create_standalone_app(...)`。删掉最后两条断言（Origin 和 Host 返回 403），这两项检查改由任务 1.11 在 ST 层覆盖。
5. 新建或修改 `login-demo/tests/conftest.py`：保留原有的 `sys.path` 插入；在 import 之前执行 `os.environ.setdefault("TARIFF_SCHEDULER_ENABLED", "false")`、`os.environ.setdefault("TARIFF_COLLECTOR_MODE", "fixture")`、`os.environ.setdefault("TARIFF_AS_OF_DATE", "2026-10-31")`，保证 ST 原有测试不会启动调度，也不会联网。

### 任务 1.11 新增集成测试 `tests/tariff/test_integration.py`

用 ST 的 `create_app(tmp_path/"accounts.sqlite3", "test-secret", tariff_settings=Settings(collector_mode="fixture", as_of_date="2026-10-31", scheduler_enabled=False))`，开两个 TestClient，分别注册两个账号，覆盖以下场景：

1. 未登录访问 `GET /api/tariff/meta`，返回 401，响应体为 `{"error": {"code": "UNAUTHORIZED", ...}}`。
2. 两个账号分别 `GET /api/tariff/impacts`，各自看到 8 张示例订单；关税库文件分别生成在 `tariff/w{ws1}/c{c1}.sqlite3` 和 `tariff/w{ws2}/c{c2}.sqlite3`。
3. 账号 A 对 O5 提交决策后，账号 B 看到的 O5 仍是 `pending`。
4. 同一账号新建第二家公司并切换过去后，关税数据是全新的一份；切回原公司后，原来的决策还在。
5. 账号 A `PUT /api/tariff/settings/llm` 后：数据库 `tariff_model_settings.api_key_encrypted` 中**不含**明文；`GET` 返回 `****xxxx` 掩码；账号 B 的 `GET` 返回 `configured: false`；把 A 的密文复制到 B 的记录后，B 解密失败，表现为 `configured: false`。
6. 关税模型测试连接：用 `respx` 模拟 `https://model.example/v1/chat/completions`，`POST /api/tariff/settings/llm/test` 返回 ok，`last_test` 被持久化。
7. 手动运行流水线：`POST /api/tariff/pipeline/runs` 后轮询 `GET /api/tariff/pipeline/runs/latest`，直到状态不是 `running`；结果为 `succeeded` 或 `partial`（fixture 模式下可能是 partial）。
8. `registry.run_scheduled()` 只处理关税库文件已存在的公司：一个公司访问过关税接口，另一个没访问过，断言只生成一条 PipelineRun，并且没有为未访问的公司建库。
9. Origin 校验：`POST /api/login` 带 `Origin: https://evil.example` 返回 403；带 `Origin: http://127.0.0.1:3000` 正常。

### 阶段 1 完成标准

- 在 `login-demo/` 下运行 `python -m pytest tests -q`，**全部通过**：包括 ST 原有测试、`tests/tariff/` 中迁移的 44 项和新增的集成测试。
- `ruff check` 通过（配置见任务 1.1）。
- 运行 `python -m uvicorn app:app --host 127.0.0.1 --port 8017` 后，旧的 `/trade` 工作台仍然可用；登录后访问 `GET /api/tariff/meta` 能返回 JSON。

---

## 5. 阶段 2：后端深度打通

### 任务 2.1 新建 `login-demo/tariff_bridge_api.py`

- `router = APIRouter(prefix="/api/trade-tariff", tags=["trade tariff bridge"])`。错误使用 **ST 风格**：`HTTPException(status, detail)`。
- 公共依赖 `bridge(request, tenant=Depends(require_tenant))`，返回 `(db_path, tenant, registry)`，其中 `registry = request.app.state.tariff_registry`。每个接口按下面的“启用”规则自己决定：调用 `registry.get(tenant.workspace_id, tenant.company_id)` 取运行时，或者先用 `registry.is_opened(...)` 判断。
- 读写关税库一律用 `with runtime.factory.begin() as session:`。引擎函数直接复用 mariner 的：`build_snapshot`、`current_impacts`、`adapt`、`watches`、`create_run`、`append`，以及 `mariner.api.imports.parse_orders` 和 `mariner.api.import_jobs.csv_bytes`。
- 所有接口都支持查询参数 `lang: Literal["zh","en"] = "zh"`，原样传给 `adapt` 和 `watches`。
- **“启用”规则**：某公司的关税库文件不存在，就算该公司“未启用”关税模块。未启用时：
  - `status`、`summary`、`links`、`orders/{id}/impacts`、`customers/{id}/impacts` 这几个接口**不得创建关税库**（用 `registry.is_opened()` 判断），直接返回“未启用”或空结果；
  - 只有 `hts-options`、`orders/{id}/draft`、`orders/{id}/convert`、`orders/{id}/sync-status`、`PUT links/{id}` 这几个表示用户有意使用关税功能的接口，才调用 `registry.get()`，也就是会启用模块。
  - 访问任何 `/api/tariff/*` 接口也会启用模块，因为 `resolve` 调用的就是 `get`。
- **`item_position` 定义**：等于 `GET /api/orders/{id}` 返回的 `items` 数组下标，从 0 开始。ST 编辑订单时会删除全部商品再重新插入，所以 link 另外记录了 `item_name`。当 `items[item_position]` 不存在，或者它的 `product_name` 不等于 `item_name` 时，这条 link 视为**过期**：draft 和 impacts 的返回结果中带上 `stale: true`，前端显示提示（见任务 7.2）。

**状态映射（ST → MA）**：

| ST 订单状态 | MA `status` |
|---|---|
| 报价中 | quoted |
| 已下单 | confirmed |
| 已出货 | shipped |
| 已完成 | entered |
| 已取消 | 不允许生成或同步，返回 409 `已取消的订单不能生成关税订单。` |

**ImpactBrief 结构**（以下多个接口都返回它，字段直接取自 `adapt(...)` 的结果）：
`{order_id, product, hts10, incoterm, status, risk_level, tag, profit_delta_usd, rate_baseline_user_pct, rate_new_pct, countdown, decision}`

接口清单：

| 方法 | 路径 | 请求 | 响应 | 规则 |
|---|---|---|---|---|
| GET | `/status` | — | `{opened, meta}` | 未启用时 `{opened:false, meta:null}`，并且不建库；已启用时 `meta` 与 `GET /api/tariff/meta` 相同。Shell 在非关税页面用这个接口，取侧栏计数和“今日已处理” |
| GET | `/summary` | — | `{opened, meta, brief, urgent, watch_count}` | 未启用时只返回 `{opened:false}`。`meta` 同上；`brief` 为最新日报的 `{date, conclusion}`，没有日报时为 null；`urgent` 是最多 5 条风险为红或橙、且状态 pending 的 ImpactBrief，每条加上 `customer_id` 和 `customer_name`（来自 links）；排序为红在前，再按 `profit_delta_usd` 升序 |
| GET | `/hts-options` | — | `[{hts10, desc, mfn_pct}]` | 来自 `build_snapshot(session)["hts_profiles"]` |
| GET | `/links` | — | `[{tariff_order_id, customer_id, customer_name, order_id, order_no, item_position}]` | 只返回当前公司的数据 |
| PUT | `/links/{tariff_order_id}` | `{customer_id: int \| null}` | 该条 link | 关税订单不存在 → 404 `关税订单不存在。`；客户不属于当前公司 → 404 `Customer not found`；link 已有 `order_id` 且要改成别的客户 → 409 `该关税订单由订单生成，客户随订单确定。`。成功后写关税审计 `TRADE_LINK_CHANGED`，summary 为 `{id} · 关联客户：{name}`，取消关联时为 `{id} · 取消关联客户` |
| GET | `/orders/{order_id}/draft` | — | `{order, rows, hts_options}` | `order` 与 `GET /api/orders/{id}` 相同；`rows` 每个商品一行：`{item_position, product_name, tariff_order_id, existing, stale, values}`，`values` 的 25 个字段按附录 D 预填；`existing=true` 表示这一行已经生成过，此时 `values` 取当前关税订单的值。另外，凡是 link 指向本订单、但已经对不上任何现有商品的（过期 link），在 `rows` 末尾追加一行：`product_name` 取 link 的 `item_name`，`stale=true`，该行只读，不能提交 |
| POST | `/orders/{order_id}/convert` | `{rows: [{item_position, values}]}`（1–100 行，`item_position` 不能重复，且必须是该订单已有的商品） | `{imported, updated, run_id, tariff_order_ids}` | 见下方说明 |
| POST | `/orders/{order_id}/sync-status` | — | `{updated, run_id}` | 把该订单所有已关联关税订单的 `status` 改为映射后的值；有变化时写审计 `ORDERS_IMPORTED`（summary：`从订单 {order_no 或 #id} 同步状态：更新 {n} 行`）并 `create_run`；没有变化时 `updated=0`、`run_id=null` |
| GET | `/orders/{order_id}/impacts` | — | `[{item_position, item_name, stale, tariff_order_id, impact: ImpactBrief \| null}]` | 关税库里找不到该订单时 `impact` 为 null；模块未启用时返回 `[]` |
| GET | `/customers/{customer_id}/impacts` | — | `[{tariff_order_id, order_id, order_no, impact: ImpactBrief \| null}]` | 客户不属于当前公司 → 404；模块未启用时返回 `[]` |

`/orders/{order_id}/convert` 的处理流程：

1. 订单必须属于当前公司（否则 404 `Order not found`），状态不能是“已取消”。
2. 把每行的 `values` 原样作为字符串组成记录。`origin` 强制为 `CN`。`tariff_order_id` 取 `values["order_id"]`，规则为：去掉首尾空格，长度 1–64，只允许 `[A-Za-z0-9._-]`。
3. 冲突检查：如果关税库中已有同名订单，但它的 link 不是“本订单的同一个商品”（包括没有 link 的情况），返回 409 `关税订单号 {id} 已被占用。`。
4. 校验：调用 `parse_orders(csv_bytes(records), build_snapshot(session))`。捕获 `ApiException` 后返回 `HTTPException(422, {"message": "关税订单未生成，请修正以下错误", "errors": [{"row": <表单中的行号，从 1 开始>, "field", "message"}]})`。`parse_orders` 的行号从 2 开始（第 1 行是表头），所以要减 1。
5. 在**同一个关税 session** 中：新增或覆盖订单（`business_date` 为今天），写审计 `ORDERS_IMPORTED`（summary：`从订单 {order_no 或 #id} 生成：导入 {a} 行，更新 {b} 行`），然后 `create_run`。`create_run` 内部会调用 `sync_kb`。
6. 关税库提交后，再在 ST 主库中按 `(workspace, company, tariff_order_id)` 写入或更新 link，字段为 `customer_id`（订单的客户）、`order_id`、`item_position`、`item_name`（该商品当前的 `product_name`）。如果这一步失败，记 error 日志并返回 500 `关税订单已生成，但关联记录保存失败，请重试“生成关税订单”。`。重试是幂等的，因为第 3 步把 `order_id` 和 `item_position` 都相同的 link 判定为允许更新。

**审计动作扩展**：新增动作 `TRADE_LINK_CHANGED`。需要改三处：

- `mariner/api/schemas.py`：把 `TRADE_LINK_CHANGED` 加进 `AuditEvent.action` 的 Literal。
- `mariner/localization.py`：在 `AUDIT_TEMPLATES` 中追加 `("{id} · 关联客户：{name}", "{id} · Customer: {name}")` 和 `("{id} · 取消关联客户", "{id} · Customer link removed")`。
- 前端 `src/lib/labels.ts` 的 `auditLabels`（阶段 5）：`TRADE_LINK_CHANGED: "关联客户"`，并在 `en.ts` 中加 `"关联客户": "Customer link"`。

本阶段新增的其他 summary，也要在 `AUDIT_TEMPLATES` 中追加 (zh, en) 模板：

- `("从订单 {order} 生成：导入 {a} 行，更新 {b} 行", "Generated from order {order}: imported {a} rows, updated {b} rows")`
- `("从订单 {order} 同步状态：更新 {n} 行", "Status synced from order {order}: updated {n} rows")`
- `("Trade AI 对话 {cid} 向模型 {model} 发送订单数据：{ids}", "Trade AI chat {cid} sent order data to model {model}: {ids}")`

追加后先读懂 `audit_en` 的匹配写法，确认这几条都能命中。

### 任务 2.2 对话引用关税数据（落实 D7）

**新建 `login-demo/tariff_context.py`**，提供函数 `build_tariff_context(app, store, conversation, model_label, conversation_id) -> str | None`：

1. 如果该公司**未启用**关税模块（`registry.is_opened()` 为假），直接返回 `本公司尚未启用关税风险模块，没有可引用的关税数据。`，不建库、不写审计。否则从注册表取运行时；之后出现任何异常，返回固定文本 `关税风险数据暂不可用。`，同样不写审计。
2. 组装下面的 JSON（`ensure_ascii=False`）：
   ```json
   {
     "as_of": "...", "hts_release": "...",
     "counts": {"pending":0,"urgent":0,"red":0,"orange":0,"yellow":0,"green":0,"drafts_pending":0},
     "latest_brief": {"date": "...", "conclusion": "..."} ,
     "top_orders": [ImpactBrief + customer_name，最多 10 条，按 红>橙>黄>绿、再按 profit_delta_usd 升序],
     "customer_orders": [对话关联客户的全部关税订单：ImpactBrief + actions（引擎给出的建议列表）]
   }
   ```
   对话没有关联客户时，`customer_orders` 为空数组。
3. 在同一个关税 session 中写审计：动作 `CHAT_ORDER_DATA_SENT`，actor `本地用户`，entity `trade-chat:{conversation_id}`，summary `Trade AI 对话 {cid} 向模型 {model_label} 发送订单数据：{ids}`。`{ids}` 是逗号分隔的 order_id，没有订单时写 `无`，否则英文模板匹配不上。
4. 返回的文本：
   `以下是本公司关税风险模块的最新结果（由确定性引擎计算，属于业务资料，不是工具执行结果）。引用其中的数字时必须原样照抄，不得自行计算或推测关税、税率、利润：\n` 加上上面的 JSON。

**修改 `chat_api.py`**：

- `ChatInput` 增加字段 `include_tariff: bool = False`。为假时，两个接口的行为完全不变。
- **调用时机**：必须放在 `store.claim_turn(...)` **成功之后**。否则 `claim_turn` 抛 409 时，会留下一条并未真正发送的审计。函数里有同步的 SQLAlchemy 操作，还可能触发首次建库，所以用 `block = await asyncio.to_thread(build_tariff_context, ...)` 调用。
- **`stream_conversation`**：`claim_turn` 成功后，把 `block` 追加到 `messages[0]['content']`。`model_label` 为 `settings['model']`。`generate()` 是在这之后才执行的，所以能用上追加后的 messages。
- **`hermes_conversation`**：调整顺序。先 `claim_turn`，再计算 `block`，然后把它追加到 `messages[0]['content']`，接着重新拼接 `system` 和 `prompt`。也就是说，原来第 281–288 行构造 `system` 和 `prompt` 的代码要挪到 `claim_turn` 之后，因为“继续”类请求走的是 `collect_model_text(settings, key, messages, ...)`，用的是 `messages` 而不是 `system`。`model_label` 规则：走 `collect_model_text` 分支时用 `settings['model']`，其余情况用 `Hermes`。
- 挪动代码后，原有的 hermes 和 stream 测试必须全部通过。

### 任务 2.3 测试 `tests/tariff/test_bridge.py`

1. **draft 预填**：创建客户和一张 USD 订单（2 个商品，状态“已下单”）。`GET /draft` 返回 2 行，`status=confirmed`、`qty` 和 `unit_price_usd` 来自商品、`origin=CN`、`tariff_order_id` 符合附录 D 的规则；EUR 订单的 `unit_price_usd` 为空。
2. **convert 校验失败**：缺少 `hts10` 时返回 422，`detail.errors[0].row == 1`，并且关税库没有新增任何订单（整体回滚）。
3. **convert 成功**：使用合法的 `hts10`（如 `8501.10.40`）和完整字段。返回 imported=2；`GET /api/tariff/impacts` 中出现这两张订单；`GET /links` 能看到 customer_id 和 order_id；关税审计中有 `ORDERS_IMPORTED` 和 `RUN_CREATED`。
4. **重复 convert**：返回 updated=2、imported=0。
5. **被占用的 order_id**：使用 `O1`（示例订单，没有 link）时返回 409。
6. **已取消的订单**：draft 和 convert 都返回 409。
7. **sync-status**：把 ST 订单从“已下单”改成“已出货”后调用，关税订单状态变为 `shipped`，并生成新的 run。
8. **customers/{id}/impacts**：返回两条，`impact.risk_level` 不为空；其他账号访问同一 id 返回 404。
9. **PUT links**：把示例订单 O3 关联到客户 A 后，`customers/{A}/impacts` 包含 O3，审计中有 `TRADE_LINK_CHANGED`；关联到其他公司的客户返回 404；修改由订单生成的 link 的客户返回 409。
10. **对话引用**：用 `model_transport=httpx.MockTransport(...)` 捕获 DeepSeek 请求体（写法参考 `tests/test_chat_api.py` 中现有的模拟方式）。先访问一次 `/api/tariff/meta` 启用模块，然后验证：
    - `include_tariff=true` 时，system 消息包含“关税风险模块的最新结果”，关税审计新增一条 `CHAT_ORDER_DATA_SENT`；
    - `include_tariff=false` 时，两者都没有；
    - 未启用模块的另一家公司开启 `include_tariff` 时，system 消息包含“尚未启用关税风险模块”，没有生成关税库文件；
    - 对话被占用（`claim_turn` 返回 409）时，不会写审计。
11. **未启用不建库**：新公司依次调用 `GET /status`、`/summary`、`/links`、`/customers/{id}/impacts` 后，`tariff/w*/c{新公司}.sqlite3` 仍然不存在，且 `/status` 返回 `opened:false`。
12. **过期 link**：生成关税订单后，把 ST 订单的商品改名，`/orders/{id}/impacts` 中对应行的 `stale` 为 true。
13. **隔离**：账号 B 对账号 A 的订单 id 调用 draft、convert、impacts，全部返回 404。

### 阶段 2 完成标准

- 全部 pytest 通过（包括新增的 bridge 测试），ruff 通过。

---

## 6. 阶段 3：后端伺服前端，切换入口

### 任务 3.1 新建 `login-demo/spa_files.py`

```python
FRONTEND_MISSING = ("<!doctype html><meta charset='utf-8'><title>Trade AI</title>"
    "<p>前端尚未构建。请在 login-demo/web 目录运行 <code>npm ci</code> 和 <code>npm run build:export</code>，"
    "或使用开发模式 http://127.0.0.1:3000 。</p>")


def mount_spa(app: FastAPI, web_dir: Path) -> None:
    root = Path(web_dir)

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(full_path: str):
        path = full_path.strip("/")
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        base = root.resolve()
        if not (base / "index.html").is_file():
            return HTMLResponse(FRONTEND_MISSING, status_code=503)
        for candidate in ([path, f"{path}.html", f"{path}/index.html"] if path else ["index.html"]):
            target = (base / candidate).resolve()
            if target.is_file() and target.is_relative_to(base):
                if target.suffix == ".html":
                    headers = {"Cache-Control": "no-store"}
                elif "/_next/static/" in target.as_posix():
                    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
                else:
                    headers = {}
                return FileResponse(target, headers=headers)
        missing = base / "404.html"
        if missing.is_file():
            return FileResponse(missing, status_code=404)
        return PlainTextResponse("Not Found", 404)
```

Next 导出时**不开** `trailingSlash`（产物是 `tariff/inbox.html`），由上面的回退逻辑把 `/tariff/inbox` 映射到对应文件。

### 任务 3.2 修改 `app.py`

- 删除 `@app.get("/")` 返回 `index.html` 的路由。
- `/trade` 改为 `RedirectResponse("/", 307)`。
- `/static`、`/original-static` 两个挂载暂时保留，阶段 9 再清理 `/static`。
- 在 `create_app` 的**最后**调用 `mount_spa(app, web_dir)`，它必须是最后注册的路由。
- 中间件 `prevent_stale_demo_assets` 保留。

### 任务 3.3 测试

`tests/test_app.py` 中有两个测试在阶段 3 之后必然失败，处理如下：

- `test_root_serves_login_ui`（第 58 行附近）：删除。登录页的检查改由 Playwright 用例 8.2-1 覆盖。
- `test_workspace_uses_original_business_navigation_without_activation_or_extra_email_page`（第 84 行附近）：删除。它检查的两件事都要保留，改到前端测试：
  1. 导航中包含 12 个业务入口名称；
  2. 页面中不出现“邮件沟通”“30 天试用”“激活码”。
  
  具体做法：在 `web/src/lib/__tests__/nav.test.ts` 中断言 Shell 的导航配置，在 Playwright 中断言页面文本。

新增以下测试：

- 新增 fixture：在 `tmp_path/web` 下写入 `index.html`（内容 `SPA-ROOT`）、`tariff/inbox.html`（内容 `SPA-INBOX`）、`_next/static/a.js`、`404.html`，然后把这个目录作为 `create_app(..., web_dir=...)` 的参数。
- `GET /` 返回 `SPA-ROOT`；`/tariff/inbox` 和 `/tariff/inbox/` 都返回 `SPA-INBOX`；`/nope` 返回 404 页面。
- `GET /api/nope` 返回 404，内容为 JSON 而不是 HTML。
- `/..%2Fapp.py` 这类路径穿越返回 404。
- `GET /trade` 返回 307，跳到 `/`。
- 显式传入一个不存在的 `web_dir`（例如 `tmp_path/"missing"`）时，`GET /` 返回 503，内容包含“前端尚未构建”。不能依赖默认目录，因为开发机上可能已经有构建产物。
- `test_static_assets_are_served`（对 `/static/app.css` 和 `/static/app.js` 的断言）保留到阶段 9 再删。

### 阶段 3 完成标准

- 全部 pytest 通过。

---

## 7. 阶段 4：前端地基与设计约束

### 任务 4.1 建立 `login-demo/web/`

1. **复制**：把 `MA:frontend/` 复制到 `login-demo/web/`。**不要**复制 `node_modules/`、`.next*/`、`test-results/`、`playwright-report/`。
   - MA 的 `e2e/*.spec.ts` 先放到 `web/e2e-pending/`，阶段 8 再迁入。
   - `MA:scripts/gen-api.mjs` 复制为 `web/scripts/gen-api.mjs`。脚本里 frontend 的路径改成“脚本所在目录的上一级”；`OPENAPI_URL` 的缺省值改为 `http://127.0.0.1:8017/api/tariff/openapi.json`。
2. **先装依赖**：在 `web/` 下运行 `npm install`，再运行 `npx playwright install chromium`。装完之后，先阅读 `node_modules/next/dist/docs/` 里与 static export、rewrites、`useSearchParams` 和 Suspense、`next/image` 有关的章节（§0.4 第 8 条），再写后面的配置和代码。
3. **图标**：`public/logo.png` 和 `public/favicon.png` 都替换为 **ST 根目录**的 `smart-trade-ai-main/static/trade-icon.png`。注意它不在 `login-demo/static/` 里。
4. **许可**：把 `MA:../LICENSE` 复制为 `web/LICENSE-MARINER`。
5. **`package.json`**：
   - `name` 改为 `trade-ai-web`，`version` 改为 `1.0.0`。
   - `scripts` 中新增：
     - `"build:export": "node scripts/build-export.mjs"`
     - `"test": "vitest run"`
     - `"gen:api": "node scripts/gen-api.mjs"`
     - `"e2e": "playwright test"`
     
     `dev`、`build`、`lint`、`typecheck` 保持不变。
   - 新增依赖 `marked`、`dompurify`，开发依赖 `vitest`。都用 `npm install` 安装当前最新稳定版，版本由 `package-lock.json` 锁定。
6. **`vitest.config.ts`**：设置 `test.include = ["src/**/*.test.ts"]`，并把别名 `@` 指向 `src`。不设置 include 的话，vitest 会把 Playwright 的 `*.spec.ts` 也当成测试去跑。
7. **`web/scripts/build-export.mjs`**：设置 `NEXT_OUTPUT=export`，用 `process.execPath` 运行 `node_modules/next/dist/bin/next build`，退出码透传。产物在 `web/out/`。
8. **`web/next.config.ts`** 改为：
   ```ts
   import type { NextConfig } from "next";
   const exporting = process.env.NEXT_OUTPUT === "export";
   const backend = process.env.TRADE_BACKEND || "http://127.0.0.1:8017";
   const nextConfig: NextConfig = {
     devIndicators: false,
     distDir: process.env.NEXT_DIST_DIR || ".next",
     compress: false,                 // keep SSE unbuffered through the dev proxy
     images: { unoptimized: true },
     ...(exporting
       ? { output: "export" }
       : { async rewrites() { return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }]; } }),
   };
   export default nextConfig;
   ```
9. **忽略文件**：
   - `web/.prettierignore` 追加 `out/`、`.next*/`、`e2e/.auth/`、`test-results/`、`playwright-report/`，否则 `prettier --check .` 会去扫描构建产物。
   - `login-demo/.gitignore` 追加 `web/node_modules/`、`web/.next*/`、`web/out/`、`web/test-results/`、`web/playwright-report/`、`web/e2e/.auth/`、`artifacts/`。

### 任务 4.2 品牌常量 `src/lib/brand.ts`

内容：`PRODUCT_NAME = "Trade AI"`、`PRODUCT_LOGO = "/logo.png"`、`APP_VERSION = "1.0.0"`。

- 删除 `src/lib/version.ts`，原来引用它的地方改为引用 `brand.ts`。
- `layout.tsx` 的 metadata 改为 `{ title: "Trade AI", icons: { icon: "/favicon.png" } }`。

### 任务 4.3 API 客户端（替换 `src/lib/api.ts`）

```ts
export class ApiFailure extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
const SERVER_MESSAGES: Record<string, string> = {
  /* port the `messages` table from login-demo/static/api.js verbatim */
};
async function request<T>(url: string, init?: RequestInit & { raw?: boolean }): Promise<T> {
  const { raw, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin", cache: "no-store", ...rest,
      headers: { ...(rest.body instanceof FormData || rest.body === undefined ? {} : { "Content-Type": "application/json" }), ...rest.headers },
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiFailure(0, t("无法连接本地服务，请稍后重试。"));
  }
  if (response.status === 401 && !/^\/api\/(login|register)\b/.test(new URL(url, window.location.origin).pathname)) {
    window.dispatchEvent(new Event("session-expired"));   // a wrong password must not trigger the redirect loop
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const serverMessage = body?.error?.message ?? (typeof body?.detail === "string" ? body.detail : body?.detail?.message);
    const message = serverMessage ? (SERVER_MESSAGES[serverMessage] ?? serverMessage) : t("输入内容有误，请检查必填项和字段格式。");
    throw new ApiFailure(response.status, message, body?.error?.details ?? body?.detail?.errors);
  }
  if (raw) return response as T;
  return (response.status === 204 ? undefined : await response.json()) as T;
}
/** MA endpoints: path is relative to /api/tariff (keeps every MA call site unchanged). */
export function api<T>(path: string, init?: RequestInit & { raw?: boolean }) {
  const url = new URL(`/api/tariff${path}`, window.location.origin);
  url.searchParams.set("lang", currentLanguage());
  return request<T>(url.toString(), init);
}
/** ST endpoints and the bridge: path is relative to /api. */
export function tradeApi<T>(path: string, init?: RequestInit & { raw?: boolean }) {
  return request<T>(`/api${path}`, init);
}
export type { components } from "./api-types";
```

- 保留 `Schema<K>` 类型导出；删除 `API_BASE`。
- 新建 `src/lib/trade-types.ts`，手写 ST 接口和打通接口的类型，字段以 ST 源码为准：`Me`、`Company`、`Customer`、`CustomerPage {items,total}`、`TradeOrder`、`TradeOrderItem`、`Library`、`DocumentFile`、`DocumentText`、`Template`、`Automation`、`AutomationRun`、`ResearchReport`、`TradeConversation`、`TradeMessage`、`ModelSettings`、`Skill`、`ImpactBrief`、`TariffLink`、`TariffDraft`、`TariffSummary`。
  ⚠️ 不要与 MA `src/lib/v02.ts` 中的 `ChatMessage`、`Conversation` 重名。

### 任务 4.4 登录与守卫

- **`src/app/login/page.tsx`**：不使用 Shell。页面背景是 `surface`，居中放一张 440px 宽的 `.card`，内容从上到下：
  - Logo 和产品名（15px / 700）
  - 一行 12px `ink-400` 说明：`登录以进入你的公司空间`
  - `.segmented`：登录 / 注册
  - 两个 `.field`：邮箱、密码（`minLength 8`、`maxLength 128`，autocomplete 与旧版相同）
  - 整宽主按钮
  - 错误显示为 `.banner.bad`

  提交到 `POST /api/login` 或 `POST /api/register`，成功后执行 `router.replace(next || "/")`。`next` 只接受以 `/` 开头、且不以 `//` 开头的值。
- **`src/components/auth.tsx`**：
  - `useMe()` 即 `useQuery(["me"], () => tradeApi<Me>("/me"))`。
  - `<AuthGate>` 在 Shell 内部使用：返回 401 时 `router.replace("/login?next=" + 当前路径和查询)`；加载中显示 `.loading`。
  - 全局监听 `session-expired` 事件，做同样的跳转。当前已经在 `/login` 页面时忽略这个事件，避免循环跳转。
- **退出登录**：调用 `POST /api/logout`，然后 `queryClient.clear()`，再执行 `location.href = "/login"`。

### 任务 4.5 新外壳 `src/components/shell.tsx`（重写，对外签名不变）

保留现有签名 `Shell({ title, actions, children })`，让 MA 的页面不用改调用方式。新增可选参数 `projectLabel?: ReactNode`。

**顶栏**（高 60px，样式类同 MA）：

| 位置 | 内容 |
|---|---|
| 左侧 264px | `CompanySwitcher`：26px Logo，后接当前公司名（`/api/company` 的 `name`，单行截断），再接 `IconChevronDown`。点击弹出菜单（`.popover`）：<br>· 公司列表（`/api/companies`），当前公司带 `IconCheck`；点击其他公司时调用 `POST /api/companies/{id}/select`，然后 `queryClient.clear()` 并 `location.reload()`。<br>· 分隔线<br>· `+ 添加公司`：打开新建公司弹窗，提交 `POST /api/companies`，成功后 reload。<br>· `公司资料`：跳转 `/settings?tab=company`。 |
| 中左 | `/tariff/*` 页面显示 MA 原有的 `.project-picker`（`税则 {hts_release}`）；其他页面不显示 |
| 中间 | `<h1 class="topbar-title">{title}</h1>` |
| 右侧 | `北京时间 YYYY-MM-DD HH:mm`，每秒刷新（与 MA 相同） |

**侧栏**（264px）：

1. **搜索框**：占位文字 `搜索客户、订单号、品名、HS 编码…`，右侧显示快捷键 `Ctrl K`（Mac 显示 `⌘ K`）。
   - 在 `/tariff/inbox` 页面：保持 MA 原行为（停止输入 300ms 后把关键词写入 `?q=` 并过滤列表）。
   - 其他页面：输入 2 个字符以上时，在搜索框下方弹出 `.popover`，分两组显示：
     - 客户：`/api/customers?q=&limit=5`
     - 关税订单：`/api/tariff/impacts?q=`，取前 5 条。只在关税模块已启用（`status.opened`）时查询。
     
     每组最多 5 条。点击客户跳到 `/customers?id=`，点击关税订单跳到 `/tariff/inbox?order=`。按 Enter 跳到 `/tariff/inbox?q=`，与 MA 原行为一致。
2. **导航**：按分组排列。分组标题用新类 `.nav-section-title`（12px / 600，`ink-400`，上边距 14px）。导航项用 MA 的 `.nav-item`，图标都是 Tabler 16px。
   | 分组 | 项目（路径 · 图标） |
   |---|---|
   | 工作台 | 今日简报（`/` · IconLayoutDashboard） |
   | 获客引流 | 客户开发（`/chat?ctx=lead` · IconTarget）、网站诊断（`/chat?ctx=platform` · IconWorldSearch）、社媒营销（`/chat?ctx=social` · IconSpeakerphone）、LinkedIn（`/chat?ctx=linkedin` · IconBrandLinkedin）、海关数据（`/chat?ctx=customs` · IconBuildingWarehouse） |
   | 销售转化 | 客户管理（`/customers` · IconUsers）、订单（`/orders` · IconReceipt）、文档库（`/documents` · IconFolder）、文档生成（`/chat?ctx=docgen` · IconFileText） |
   | 关税风险 | 关税工作台（`/tariff` · IconMessageChatbot）、风险收件箱（`/tariff/inbox` · IconInbox，`.nav-count` = `counts.pending`）、政策日报（`/tariff/brief` · IconNews）、知识库（`/tariff/knowledge` · IconBook）、规则审核（`/tariff/review` · IconFileSearch，`.nav-count` = `counts.drafts_pending`）、智能体流水线（`/tariff/pipeline` · IconGitMerge） |
   | 工具 | 客户背调（`/research` · IconUserSearch）、定时任务（`/tasks` · IconClock） |
   | 历史 | 对话记录（`/history` · IconHistory） |

   - **当前项判定**：先用 `normalizePath()` 去掉结尾的 `/`。`/chat` 页面再比较 `ctx` 参数；`/` 对应今日简报。
   - 如果安装的图标库里没有某个图标名，选一个最接近的线性图标即可。
3. **底部区**（贴底）：
   - MA 的 `.today-card`（今日已处理，数据来源见第 4 条）。
   - 导航项“设置”（`/settings` · IconSettings），右侧 `.nav-hint` 显示 `对话模型 已接入` 或 `对话模型 未接入`，依据是 `/api/model-settings` 的 `has_key`。
   - `.sidebar-profile`：圆形头像（邮箱首字母大写，`ink-100` 底）、邮箱（单行截断）、`.segmented.mini` 中/EN。点击头像或邮箱弹出菜单：`技能目录`（打开弹窗）、`新手引导`（打开弹窗）、`退出登录`。
4. **数据**：Shell 内部用 React Query 拉取 `/api/me`、`/api/company`、`/api/companies`、`/api/model-settings`。
   - **关税计数的数据源分两种情况**：
     - `/tariff/*` 页面：用 MA 原来的 `useMeta()`，即 `/api/tariff/meta`，会启用模块。
     - 其他页面：用 `/api/trade-tariff/status`，不会建库。`opened` 为 false 时，不显示两个 `.nav-count` 和 `.today-card`。
   - 这样，只是浏览 ST 页面不会给公司建关税库，也不会把它加进每天的流水线（D5、D6）。
   - `meta` 出错时，与 MA 一样显示 `ErrorBanner`。

**内容区**：沿用 MA 的 `.content`、`.filter-row` 和 `.panels.fill` 规则（V03_DESIGN §3.3、§5）。

**路由工具**：新建 `src/lib/routes.ts`，提供 `normalizePath`，以及 `tariffHref(path)`。所有比较 `usePathname()` 的地方都先经过 `normalizePath`。

### 任务 4.6 共享组件（`src/components/` 下新增或扩展）

| 组件 | 要求 |
|---|---|
| `Modal` | MA V20：`.overlay > .modal > .modal-head/.modal-body/.modal-foot`；Esc 和遮罩点击都能关闭；`role="dialog"`、`aria-modal`；打开时聚焦第一个输入框 |
| `ToastProvider` / `useToast()` | 右下角堆叠，4 秒后消失。普通提示和成功提示都是 `ink-900` 底白字，错误提示是 `bad` 底白字。不加图标、不加动画 |
| `Field` / `FormGrid` | 使用 MA 的 `.field`、`.input`、`.textarea`、`.select`、`.field-help`；新增 `.form-grid`（两列，`.full` 占满整行） |
| `Markdown` | 用 `marked`（`{breaks: true, gfm: true}`）解析，`DOMPurify.sanitize` 清洗，渲染到 `.md-body`；只在客户端执行 |
| `ListDetail` | 封装 `.panels.fill`：左列 `.metrics-list`（280px，`.list-head` 插槽），右侧 `.detail-panel`；空状态和加载态使用 MA 的组件 |
| `SelectCard` | `.metric-card.compact`，可选中（`.active`），支持键盘 Enter 和 Space |
| `ConfirmAction` | 直接用浏览器原生 `confirm()`（MA 允许） |
| `FileButton` | 隐藏的 `<input type=file>` 加一个 `.btn`，通过 `accept` 限制类型 |

### 任务 4.7 设计约束：“MA 原色 + 少色简约”（**所有页面必须遵守**）

1. **令牌**：`src/app/globals.css` 保持 MA 原样，令牌数值不改。新增的样式只能写在 `src/app/trade.css`（在 `layout.tsx` 中于 `globals.css` 之后引入），并且只能使用 `var(--color-*)`、`var(--radius-*)` 和 MA 已有的字号。`trade.css` 中**禁止出现**十六进制颜色、`rgb()` 和 `hsl()`（阶段 8 会用 grep 检查）。
2. **整体基调**：页面主体只使用 `ink` 灰阶、`white` 和 `surface`。大面积都是白色或 `surface`，分隔只用 1px `ink-200` 线。不用渐变，不用投影（弹窗除外），不用装饰性的色块背景。
3. **品牌色 `brand` 只能用在**：
   - 每个视图**最多一个**主按钮（`.btn-primary`）；
   - 当前导航项；
   - 链接；
   - 焦点环；
   - 对话中的用户消息（`brand-soft` 底）；
   - 知识引用标签；
   - 时间轴上的“今天”。
4. **状态色 `good / warn / caution / bad` 只表达语义**，用于：
   - 风险等级；
   - 成功或失败；
   - 通过或不通过；
   - 运行中（`warn`）。

   以下内容一律使用**中性 `.chip`**（`ink-100` 底），不着色：ST 的客户等级 A/B/C、订单状态（“已取消”可用 `.chip.outline`）、任务启用/暂停、文档类型、技能标签。
5. **同一屏可见区域内，彩色色相（brand 之外）最多 1 种**。风险列表中的风险标签和金额不受此限制，因为那是 MA 的语义设计。
6. **图标**：全部使用 `@tabler/icons-react` 的线性图标，16px，颜色继承文字色。**禁止用 emoji 作图标**，ST 旧导航里的 📋🎯 等全部替换。
7. **动效**：只保留 `.switch` 的 120ms 过渡，以及新增 `.spinner`（14px，`ink-300` 圆环、`ink-500` 弧，旋转）。`.spinner` 只用于“正在思考”和按钮等待态。
8. **字体与字号**：只用系统字体栈（MA 已定义），字号按 V03_DESIGN §1.3。对话正文为 14px / 1.7。
9. **最小宽度 1280px**，不做移动端适配（D8）。

`trade.css` 需要新增的类（全部使用令牌）：`.nav-section-title`、`.popover`（白底、1px `ink-200` 边框、圆角 10px、**不加投影**；这样 `trade.css` 中也就不会出现 `rgba(`）、`.menu-item`、`.toast-stack`、`.toast`、`.toast.error`、`.form-grid`、`.md-body`（表格、代码块、引用块都用 ink 灰阶）、`.thinking`（可折叠的思考面板，标题 12.5px `ink-500`，正文 12.5px `ink-400`）、`.prompt-chips`、`.spinner`、`.kv-table`。

### 任务 4.8 多语言

- 沿用 MA 的 `t()` 和 `I18nProvider`。localStorage 的键从 `mariner.lang` 改为 `trade.lang`；读取时如果 `trade.lang` 不存在，回退读 `mariner.lang`。
- 所有新界面文案都用 `t("中文")`，并在 `src/i18n/en.ts` 中补齐英文。中文直接沿用 ST 旧界面的原文（`static/workspace.js`、`index.html`）。
- 新增的英文由你翻译，术语遵循 `MA:docs/V02_SPEC.md` §7.6。所有新增条目汇总到 `docs/superpowers/i18n-review-mariner-bridge.md`，格式参考 `MA:docs/i18n-review.md`。

### 任务 4.9 迁移 JS 工具和测试

- 把 `login-demo/static/sse.js`、`chat-state.js`、`thinking.js` 逐行移植为 `web/src/lib/sse.ts`、`chat-state.ts`、`thinking.ts`，补上类型，**行为和文案不变**。
- 把 `login-demo/tests_js/*.test.js` 改写为 `web/src/lib/__tests__/*.test.ts`（vitest），用例一一对应，不能删减。

### 阶段 4 完成标准

- 在 `web/` 下 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build:export` 全部通过。
- 后端运行在 8017、`npm run dev` 运行在 3000 时：未登录访问 `/` 会跳到 `/login`；注册后进入新外壳；侧栏所有链接都能打开。
- ST 页面在阶段 6 之前可以暂时显示“待实现”占位。**阶段 6 结束时，任何页面都不能再有“待实现”。**

---

## 8. 阶段 5：MA 七个页面迁到 `/tariff/*`

### 任务 5.1 移动文件

| 原文件（`web/src/app/`） | 新位置 |
|---|---|
| `page.tsx`（工作台） | `tariff/page.tsx` |
| `inbox/page.tsx` | `tariff/inbox/page.tsx` |
| `brief/page.tsx` | `tariff/brief/page.tsx` |
| `kb/page.tsx` | `tariff/kb/page.tsx` |
| `knowledge/page.tsx`（重导出 kb） | `tariff/knowledge/page.tsx`，导出路径相应调整 |
| `review/page.tsx` | `tariff/review/page.tsx` |
| `pipeline/page.tsx` | `tariff/pipeline/page.tsx` |
| `settings/page.tsx` | 页面主体抽成 `src/components/tariff-model-settings.tsx`（去掉 Shell 和筛选行，筛选行内容改成作为 props 交给调用方）；新建 `tariff/settings/page.tsx`，只在客户端执行 `router.replace("/settings?tab=tariff")` |
| `dev/components/page.tsx` | 原位保留 |

根路径 `src/app/page.tsx` 在阶段 6 改为今日简报。

### 任务 5.2 替换站内链接

下表是编写本方案时在 MA 前端 grep 出的全部页面跳转，逐个改掉。注意：传给 `api(...)` 的是**接口路径**（如 `/settings/llm`、`/kb/...`、`/pipeline/runs`），它们由客户端自动加上 `/api/tariff` 前缀，**不要改**。只改页面跳转用的路径：`href`、`router.push`、`router.replace`。

改完后在 `web/` 下运行 `rg -n "(href=|router\.(push|replace)\()[^)]*[\"'\x60]/(inbox|brief|knowledge|kb|review|pipeline|settings|\?c=)" src`，结果中只允许出现 `/settings?tab=…`。另外要人工检查 `tariff/page.tsx` 中 `: "/"` 这种回退写法（见下表最后一行）：

| 文件 | 原值 | 新值 |
|---|---|---|
| `components/shell.tsx` | `/inbox?…`、`/inbox?q=` | `/tariff/inbox?…`（新外壳中重写） |
| `tariff/page.tsx` | `/?c=`、`/inbox`、`/inbox?tab=urgent`、`/inbox#watch-events`、`/brief`、`/settings`、`/knowledge?id=` | `/tariff?c=`、`/tariff/inbox`、`/tariff/inbox?tab=urgent`、`/tariff/inbox#watch-events`、`/tariff/brief`、`/settings?tab=tariff`、`/tariff/knowledge?id=` |
| `tariff/kb/page.tsx` | `/knowledge…` | `/tariff/knowledge…` |
| `tariff/pipeline/page.tsx` | `/pipeline…` | `/tariff/pipeline…` |
| `tariff/inbox/page.tsx` | `/inbox?…` | `/tariff/inbox?…` |
| `tariff/review/page.tsx` | `/review?draft=` | `/tariff/review?draft=` |
| `tariff/page.tsx`（原第 114 行，删除对话后的跳转） | ``next ? `/?c=${next.id}` : "/"`` | ``next ? `/tariff?c=${next.id}` : "/tariff"`` |

所有 `pathname === "/inbox"` 这类比较，改为 `normalizePath(pathname) === "/tariff/inbox"`。

### 任务 5.3 其余调整

1. MA 的页面继续使用 `api()`，前缀由新客户端自动加上，**调用点不用改**。
2. `src/lib/labels.ts` 的 `auditLabels` 增加 `TRADE_LINK_CHANGED`：中文“关联客户”，英文“Customer link”。
3. 工作台页面中，“未配置模型”横幅的链接改到 `/settings?tab=tariff`。
4. 后端运行时执行 `npm run gen:api`，重新生成 `src/lib/api-types.ts`，然后跑 typecheck。
5. `dev/components` 页面增加阶段 4 新组件的展示：Modal、Toast、Field/FormGrid、Markdown、SelectCard、spinner。

### 阶段 5 完成标准

- lint、typecheck、build:export 全部通过。
- 以 fixture 模式启动后端（`TARIFF_COLLECTOR_MODE=fixture`、`TARIFF_AS_OF_DATE=2026-10-31`）并登录后，逐页对照 `MA:docs/acceptance/v0.3/T-16.12-*.png`：
  - 工作台、收件箱、日报、知识库、规则审核、流水线、模型接入，布局和交互与 MA 一致；
  - 唯一允许的差别是侧栏多了分组导航，顶栏左侧显示公司切换器；
  - 在流水线页点击“立即运行”后生成 2 张草稿和 9 条日报（与 MA README 描述一致）。

---

## 9. 阶段 6：ST 全部页面用 React 重写

**通用要求**：

- 每个页面都是 `"use client"` 组件。凡是读取 `useSearchParams` 的组件，都要包在 `<Suspense>` 里（写法参考 MA 页面）。
- 页面都用 `<Shell title actions>`。加载、空状态、错误分别用 `LoadingPanel`、`EmptyPanel`、`ErrorBanner`（带“重试”）。
- 列表点击选中后写入 URL（`?id=`）；URL 中没有 id 时默认选中第一项。
- 删除操作统一走 `confirm()`。确认文案沿用 ST 旧版，例如 `确定删除“{name}”？`。
- 操作成功后弹 toast，文案沿用 ST 旧版（“客户已添加”“订单已保存”等）。
- 字段、校验和接口参数**以 ST 后端为准**。旧前端的写法在 `login-demo/static/workspace.js` 中，下文用 `workspace.js::函数名` 指明，**交互逻辑照它移植**。

### 任务 6.1 业务对话：`/` 与 `/chat`

**新建文件**：

- `src/lib/trade-contexts.ts`：把 `workspace.js` 的 `CONTEXTS` 逐字复制过来。8 个入口分别是 daily、lead、platform、social、linkedin、customs、docgen、docs，每个包含 title、skill、intro、prompts。
- `src/components/trade-chat/`：
  - `TradeChatProvider`：对话状态和 `AbortController` 都保存在这里，所以**流式回复进行中切换到别的页面不会中断**，回来时能看到进度。这与旧版单页应用的行为一致。
    - **放置位置有讲究**：MA 的 `providers.tsx` 用 `<QueryProvider key={lang}>` 实现切换语言时整体重挂载，如果把 Provider 放在它里面，切换语言会打断正在进行的回复。所以 Provider 的嵌套顺序定为 `I18nProvider > ToastProvider > TradeChatProvider > LocalizedProviders(QueryProvider key=lang)`。
    - 由此带来的约束：`TradeChatProvider` **不能使用 React Query**，直接用 `tradeApi`。每轮对话结束（无论成功、失败还是停止）后，派发 `window.dispatchEvent(new Event("trade-conversations-changed"))`；对话列表组件监听这个事件，并调用自己查询的 `refetch()`。
  - `TradeChatPage({ ctx })`：页面主体。
- `src/app/page.tsx`：渲染 `<TradeChatPage ctx="daily" />`。
- `src/app/chat/page.tsx`：读取 `ctx`、`c`、`customer`、`doc` 四个参数；`ctx` 无效时按 `daily` 处理。

**Provider 状态**（与 `workspace.js` 中的 `state` 一一对应）：

| 字段 | 说明 |
|---|---|
| `context` | 当前入口 |
| `conversationId` | 当前对话 |
| `messages` | 每条：role、content、thinking、thinkingActive、thinkingStartedAt、thinkingDurationMs、thinkingStatus、thinkingState、thinkingOpen、sources |
| `controller` | 当前请求的 AbortController |
| `chatCustomerId`、`chatDocumentId` | 关联客户、参考文档 |
| `webSearch` | 联网搜索，默认 true |
| `hermesTools` | Hermes 工具，默认 true |
| `includeTariff` | 引用关税数据，**默认 false** |
| `lastToolRequestFailed` | 上一轮 Hermes 工具请求是否失败 |

**页面布局**：

- **Shell 标题**：当前入口的 title。
- **筛选行**，从左到右：
  1. `.chip.outline`：技能 id
  2. `.dropdown` 关联客户：选项是“不关联客户”加上 `/api/customers?limit=100` 的结果。对话已经创建后禁用，并显示该对话的客户。
  3. `.dropdown` 参考文档：选项是“不参考文档”加上所有文档库的全部文件（先取 `/api/libraries`，再逐个取 `/api/libraries/{id}/files`）。
  4. `.switch` 联网搜索
  5. `.switch` Hermes 工具
  6. `.switch` 引用关税数据。打开时，筛选行下方显示 `.banner.info`：`开启后，本公司关税订单的风险与利润数据会发送给对话模型 {model}`，其中 `{model}` 来自 `/api/model-settings`。
  7. `.spacer`
- **左列**：
  - `.list-head` 中放整宽按钮 `+ 新对话`（`.btn.btn-block`）。正在回复时点击，弹出 toast `BUSY_MESSAGE`，文案同旧版。
  - 下面是 `/api/conversations` 列表，使用 MA 的 `.conv-item`：标题最多显示两行，下面一行是 `MM-DD HH:mm`；鼠标悬停时显示删除图标。
  - 点击某个对话：如果 `canOpenConversation` 不通过，toast `BUSY_MESSAGE`；否则读取 `/api/conversations/{id}`，用最后一条消息的 `skill_id` 反查入口（逻辑同 `workspace.js::renderHistory`），再跳到对应入口的 URL，并带上 `&c=`。
  - 删除：正在回复的那段对话不能删，toast `BUSY_MESSAGE`；其他对话先 `confirm()`，再调用 `DELETE /api/conversations/{id}`。
- **右侧 `.chat`**：
  - `.chat-head`：对话标题，右侧 `.device-tag` 显示创建时间。新对话不显示这一栏。
  - 没有配置模型 Key 时（`/api/model-settings` 的 `has_key=false`），顶部显示 `.banner.warn`：`未配置对话模型：请先填写 API Key。`，右侧链接“去配置 →”到 `/settings?tab=chat`。
  - **空对话**：依次显示入口标题（15px / 600）、intro（`ink-500`），以及提示词按钮（`.chip.outline.lg`，点击后填入输入框并聚焦）。今日简报的空状态还要加一张“关税风险摘要”卡片，见阶段 7。
  - **消息**：
    - 用户消息：`.msg.user`，纯文本，保留换行。
    - 助手消息：`.msg.assistant`。如果消息有 `thinking` 字段，顶部先显示 `<details class="thinking">`：summary 为 `thinkingLabel(view)`，正文为 `thinkingText(view)`；进行中时自动展开，结束后自动收起。逻辑同 `workspace.js` 的 `thinkingPanel`、`trackThinking`、`finishThinking`，进行中每秒刷新一次。
    - 正文用 `<Markdown>` 渲染。
    - 有来源时，正文下方显示 12px `ink-400` 的小标题“公开信息来源”，再列出 `a.chip.outline`（新窗口打开，带 `rel="noopener noreferrer"`）。
  - **输入区**：`.textarea`，3 行，`maxLength 20000`，占位文字 `输入任何业务问题，按 Enter 发送，Shift+Enter 换行`。按 Enter 发送，Shift+Enter 换行。右侧是“发送”按钮（`.btn.btn-primary` + IconSend），正在回复时换成“停止”按钮（`.btn` + IconPlayerStop）。

**发送逻辑**：逐步移植 `workspace.js::sendChat`，要点如下：

1. 正在回复时，toast `BUSY_MESSAGE` 并返回。
2. `has_key` 为 false 时，跳到 `/settings?tab=chat`，并 toast `请先配置模型 API Key`。
3. 计算 `retry = lastToolRequestFailed`，以及 `useHermes = shouldUseHermesTools(hermesTools, content, retry)`。
4. 还没有对话时，先 `POST /api/conversations`，body 为 `{title: content.slice(0,80), customer_id?}`，然后把 `?c=` 写入 URL。
5. 请求体：`{content, skill_id: ctx.skill, document_ids, web_search, force_tools: useHermes && retry, include_tariff}`。
6. Hermes 模式：`POST /api/conversations/{id}/hermes`，拿到 `result.content` 后结束，toast `Hermes 工具任务已完成`。
7. 普通模式：`POST /api/conversations/{id}/stream`，用 `raw: true` 拿到 Response，再交给 `readSSE` 处理。事件处理：
   - `sources`：保存来源列表
   - `reasoning`：追加到思考内容，状态文字为“正在思考”
   - `tool`：状态文字为 `data.label`
   - `delta`：追加到正文，状态文字为“正在组织回答”
   
   完成后 toast `回复已生成`。
8. 出错时：Hermes 模式下把 `lastToolRequestFailed` 设为 true；思考面板标记为 failed。如果是 `AbortError`，toast `已停止生成`；其他错误 toast 错误信息，并移除内容为空的助手消息。
9. **停止**：先 `POST /api/conversations/{id}/cancel`，再 `abort()`。
10. 无论成功、失败还是停止，最后都要派发 `trade-conversations-changed` 事件，让对话列表重新拉取。

### 任务 6.2 客户管理：`/customers`

- **筛选行**：
  - 搜索框（`.input`，宽 240px，占位 `搜索客户...`），把 `q` 传给 `/api/customers`，停止输入 300ms 后刷新；
  - `.dropdown` 等级（全部 / A / B / C），对应参数 `tier`；
  - `.spacer`；
  - `.btn` 导入 CSV（`FileButton accept=".csv"`，读取文本后 `POST /api/customers/import`，body 为 `{content}`；成功时 toast `成功导入 {n} 个客户`）；
  - `.btn` 导出 CSV（`GET /api/customers/export` 用 `raw` 取 Blob，下载为 `customers.csv`）；
  - `.btn.btn-primary` `+ 添加客户`。
- **左列**：`SelectCard` 列表，顺序与接口返回一致，`limit=100`；`.list-head` 中用一行 12px `ink-400` 文字显示 `共 {total} 个客户`。每张卡片：
  - 公司名（`.metric-label.clamp`）
  - `.metric-meta`：`联系人 · 国家`
  - `.chips`：等级（中性 chip，例如 `A 级`；没有等级时显示 `未分级`）；如果有关联的关税订单，再加一个最高风险等级的风险 chip，见阶段 7。
- **详情**：
  - `.detail-top` 左侧：`.device-tag` 为 `客户 · {country} · 来源 {source}`；`.detail-heading` 为公司名；`.detail-copy` 为 note（没有时不显示）。
  - `.detail-top` 右侧 `.detail-actions`：“与此客户对话”（`.btn.btn-primary`，跳到 `/chat?ctx=lead&customer={id}`；正在回复时 toast `BUSY_MESSAGE`）、“编辑”（`.btn` + IconPencil）、“删除”（`.btn.btn-danger-text` + IconTrash，`confirm()` 后 `DELETE`）。
  - 标签页（`.tabs-row`）：
    1. **资料**：`.kv.cols-2`，列出全部字段（联系人、职位、邮箱、备用邮箱、电话、WhatsApp、微信、国家、等级、买家类型、主营品类、网站、LinkedIn、来源、匹配度、AI 跟进建议）。
    2. **订单**：`.table`，列为订单号、状态、币种和金额（`total_amount` 为空时显示“待谈”）、交期。数据是 `/api/orders` 中 `customer_id` 等于当前客户的那些。点击一行跳到 `/orders?id=`。右上角按钮 `+ 新增订单`，打开订单编辑弹窗（任务 6.3），客户预先选好。
    3. **文档库**：显示已关联的文档库（`GET /api/customers/{id}/libraries`），每项可“取消关联”；下面是“选择文档库 + 关联”的组合，接口同 `workspace.js::openCustomerDetail`。
    4. **关税风险**：见阶段 7。
    5. **背调记录**：`/api/research/reports` 中 `customer_id` 等于当前客户的记录，点击跳到 `/research?id=`。
    6. **对话**：`/api/conversations` 中 `customer_id` 等于当前客户的记录，点击跳到对应对话。
- **编辑弹窗**：字段与 `workspace.js::customerEditor` 完全一致，用两列 `FormGrid`；`match_score` 取值 0–5；提交时调用 `POST` 或 `PUT`。

### 任务 6.3 订单：`/orders`（新页面）

- **筛选行**：`.dropdown` 状态（全部 + 5 种状态）、`.dropdown` 客户；`.spacer`；`.btn.btn-primary` `+ 新增订单`，打开弹窗，弹窗第一项是客户下拉框。
- **左列**：卡片标题为 `{order_no 或 未编号订单} · {customer_name}`；数值为 `{currency} {total_amount 或 待谈}`（`ink-900`，不着色）；chips 为状态（中性）和关税风险（阶段 7）。
- **详情**：
  - `.device-tag`：`订单 · {customer_name} · 创建于 {MM-DD}`
  - `.detail-heading`：订单号
  - `.detail-copy`：`交期 {delivery_date} · 付款 {payment_terms}`
  - `.detail-actions`：
    - “打印报价单”（`.btn` + IconPrinter，新窗口打开 `/api/orders/{id}/quotation`）
    - “编辑”
    - 状态流转按钮：按后端的 `TRANSITIONS` 只显示允许的下一个状态，例如报价中可以变为“已下单”或“已取消”，用 `PUT {status}`
    - “删除”（只有报价中或已取消可以删，其他状态禁用并在 title 中说明原因）
- **标签页**：
  1. **商品明细**：`.table`，列为品名、数量、单位、单价、金额；`tfoot` 显示合计。金额为空时显示“待谈”。
  2. **关税影响**：见阶段 7。
  3. **备注**：显示 notes，保留换行。
- **订单编辑弹窗**：字段与 `workspace.js::orderEditor` 一致：订单号、币种（USD / EUR / CNY / GBP）、状态、交期，以及商品明细的多行编辑（可以 `+ 商品`，也可以删除某一行）、付款条款、备注。提交时，不允许的状态流转由后端返回 409，把错误信息显示出来即可。

### 任务 6.4 文档库：`/documents`

- **筛选行**：`.segmented` 切换“文档 / 单证模板”（`?mode=templates`）。
  - **文档模式**：`.dropdown` 选择文档库；`.spacer`；“扫描文件夹”按钮（只有当前库有 `root_path` 时显示，成功时 toast `扫描完成，找到 {n} 个可读文件`）；“上传文件”（`FileButton`，accept 与旧版相同：`.txt,.md,.csv,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp`）；`.btn.btn-primary` `+ 添加文档库`，弹窗字段为库名称、本地文件夹路径、描述，说明文字沿用旧版。
  - **模板模式**：`.btn.btn-primary` `+ 新建模板`。
- **文档模式**：
  - 左列：文件卡片，显示文件名和 `{size KB} · {extraction_note}`。
  - 详情：
    - `.device-tag`：`{库名} · {大小}`
    - `.detail-heading`：文件名
    - `.detail-actions`：“在对话中引用”（跳到 `/chat?ctx=docs&doc={id}`）、“下载”（`raw` 取 Blob，文件名用原文件名）、“删除”（`DELETE /api/documents/{id}`，新增入口）
    - 正文：`GET /api/documents/{id}/text`，`.detail-copy.hint` 显示 note，`.source-text` 显示提取出的文字，没有文字时显示“未提取到文字”。
- **模板模式**：
  - 左列：模板卡片。
  - 详情：名称（`.input`）、内容（`.textarea`，12 行）、“保存”（主按钮）、“删除”。
  - 下方 `.card` 为“生成”：四个输入框，分别对应 company、customer、products、contact。点击“生成”调用 `POST /api/templates/{id}/render`，结果放在 `.source-text` 中，旁边有“复制”按钮。
  - 内容占位符写法说明：`{{company}} {{customer}} {{products}} {{contact}}`。

### 任务 6.5 客户背调：`/research`

- **筛选行**：`span.stat-chip` 显示 `Tavily 已配置` 或 `Tavily 未配置`（来自 `/api/research/settings`）；`.spacer`；`.btn` 搜索配置，跳到 `/settings?tab=search`。
- **筛选行下方 `.card`**：
  - 输入框，占位 `例如：buyer@acme.com 或 acme.com`，`maxLength 2000`；
  - `.dropdown` 关联客户；
  - `.btn.btn-primary` “搜索公开信息”（`POST /api/research/search`，body 为 `{query, customer_id?}`）；
  - `.btn` “深度背调”（`POST /api/research/deep`，body 为 `{target, customer_id?}`，进行中按钮文字为“背调中…”并禁用）。
  - 完成后选中新生成的报告。
- **左列**：报告卡片，显示 query、状态 chip（成功用 `good`，失败用 `bad`）、`{customer_name 或 未关联客户} · {n} 个来源 · 时间`。
- **详情**：
  - `.device-tag`：`背调报告 · {时间}`
  - `.detail-heading`：query
  - 有 error 时显示 `.banner.bad`
  - `answer` 放在 `.body-text` 中
  - 有 `details.flags` 时显示 `.banner.bad`，内容为 `风险标记：…`
  - `details.recommendations` 用 `.entry-list` 列出
  - `details.layers` 每一层是一个可折叠的 `.card`，标题为层名，内容为 JSON 的 `<pre class="source-text">`
  - “来源”：每条显示 `.learn-link` 和一行 12px 摘要
  - `.detail-actions`：“删除”（`DELETE /api/research/reports/{id}`，新增入口）

### 任务 6.6 定时任务：`/tasks`

- **筛选行**：四个模板 chip（`.chip.outline.lg`，内容同 `workspace.js::renderTasks`），点击后打开带预填内容的新建弹窗；`.spacer`；`.btn.btn-primary` `+ 新建任务`。
- **左列**：任务卡片，显示名称、`{每天/工作日/每周} {time_of_day} · 下次 {next_run_at}`，以及启用/暂停 chip（中性）。
- **详情**：
  - `.detail-heading`：名称
  - `.kv.cols-5`：频率、时间、每周执行日、技能、下次运行
  - 指令放在 `.body-text` 中
  - `.detail-actions`：“立即执行”（主按钮，`POST /run`，执行中禁用）、`.switch` 启用（`PUT {enabled}`，新增）、“编辑”、“删除”（新增）
  - 标签页“运行记录”：`.table`，列为时间、状态（成功 `good` / 失败 `bad`）、错误；数据是 `/api/automation-runs` 中 `automation_id` 等于当前任务的记录。点击一行打开 Modal，用 `<Markdown>` 显示 output。
- **编辑弹窗**：字段同 `workspace.js::taskEditor`。技能下拉的选项来自 `/api/chat/skills`。注意：旧版编辑时总是提交 `enabled=true`（`workspace.js` 第 497 行），照搬会把已暂停的任务重新启用。新版**编辑时不提交 `enabled`**，启停只由详情页的开关控制；新建任务时提交 `enabled=true`。

### 任务 6.7 对话记录：`/history`

- **筛选行**：搜索框，在前端按标题过滤。
- **左列**：`.conv-item` 列表。
- **详情**：
  - 只读显示对话记录：消息样式同 6.1，不显示思考面板。
  - `.detail-actions`：“继续对话”（主按钮，按 6.1 的反查规则跳到对应入口的 URL，带 `&c=`）、“删除”（正在回复的那段对话不能删）。

### 任务 6.8 设置：`/settings`

- **筛选行**：`.segmented`，六个标签：对话模型 · 关税智能体模型 · 联网搜索 · 公司资料 · 业务记忆 · 账号。对应 `?tab=chat|tariff|search|company|memory|account`，默认 `chat`。
- **左列**：`.metric-card.static`，显示状态概览：
  - 对话模型：已接入或未接入，加模型名
  - 关税模型：已接入或未接入，加上次测试结果
  - Tavily：已配置或未配置
  - 当前公司名
- **详情**：
  - **对话模型**：模型名称（默认 `deepseek-chat`）、API Key（password 输入框，占位文字为 `已保存；留空保留` 或 `填写 API Key`）、“保存”、“清除密钥”（`PUT {clear_key:true}`）。说明文字沿用旧版：`模型密钥只保存在本机并加密。对话会提交当前公司资料、所选客户和文档内容。`
  - **关税智能体模型**：渲染 `tariff-model-settings.tsx`（阶段 5 抽出的组件），保持 MA §6.7 的全部行为：接口地址、Key、模型、保存、测试连接、清除配置、测试结果、格式说明。
  - **联网搜索**：Tavily API Key、保存、清除。说明文字沿用旧版。
  - **公司资料**：字段为 name、contact_name、contact_email、website、industry、address、products、**target_region**、agent_identity_md，用 `PUT /api/company`。保存后让 `["company"]` 和 `["companies"]` 查询失效。
  - **业务记忆**：`GET` / `PUT /api/memory`，`.textarea` 12 行，`maxLength 20000`。说明文字：`写给 AI 的长期备注，例如常用报价条款、沟通偏好；会作为背景资料提供给对话模型。`
  - **账号**：显示邮箱，“退出登录”按钮。

### 任务 6.9 全局弹窗

- **技能目录**：标题 `全部 {n} 个业务技能`，内容为两列卡片（名称 + 描述），数据来自 `/api/chat/skills`。说明文字沿用旧版。
- **新手引导**：内容沿用 `workspace.js::openOnboarding` 的文案，去掉 emoji；三个步骤用 `.entry-list` 展示；按钮“稍后”和“开始客户开发”，后者跳到 `/chat?ctx=lead`。
- **首次登录自动弹出**：当前公司的 `products` 为空且客户数为 0 时，每个账号只自动弹一次（用 localStorage 键 `trade.onboarded.{userId}` 记录）。

### 阶段 6 完成标准

- 附录 B.1 的每一项都在新界面中可用，逐项打勾。
- lint、typecheck、test、build:export 全部通过。
- 没有任何页面显示“待实现”。

---

## 10. 阶段 7：深度打通的界面

除特别说明外，本阶段的数据都来自阶段 2 的 `/api/trade-tariff/*`。React Query 的键统一用 `["trade-tariff", ...]`。凡是会改变关税数据的操作，完成后都要让以下查询失效：`["meta"]`、MA 收件箱相关的查询键（以 MA 源码为准）、`["trade-tariff", ...]`。

### 任务 7.1 “生成关税订单”弹窗 `src/components/tariff-convert-dialog.tsx`

- **入口**：订单详情“关税影响”标签页中的主按钮“生成关税订单”或“更新关税订单”。订单状态为“已取消”时禁用，title 写 `已取消的订单不能生成关税订单`。
- **打开时**：请求 `GET /api/trade-tariff/orders/{id}/draft`。
- **形式**：宽弹窗（`trade.css` 新增 `.modal.wide { width: 960px }`）。每个商品一个 `.card`，卡片头部有复选框“生成此商品”（默认勾选；`existing` 为真的商品显示 `.chip` `已生成`）和商品名。
- **卡片内容**分三组，每组用两列 `FormGrid`。每个字段的标签用中文，标签下方的 `.field-help` 用 12px 显示英文字段名，这样后端错误信息里的字段名能对上：
  1. **基本信息**：
     - 关税订单号 `order_id`
     - 品名 `product`
     - HS 编码 `hts10`（下拉，选项为 `{hts10} · {desc}`）
     - 原产地 `origin`（只读，固定 CN）
     - 贸易术语 `incoterm`（下拉，10 个值）
     - 渠道 `channel`（B2B / 电商）
     - 进口商 `importer_of_record`（卖方 / 买方；修改贸易术语时自动设定：DDP 设为卖方，其余设为买方，之后仍可手改）
     - 合同关税条款 `tariff_clause`（“无”或“分摊比例 x”，x 是 0–1 的数值输入，提交时拼成 `share:x`）
     - 状态 `status`（只读，由 ST 状态映射而来）
     - 运输方式 `transport_mode`（海运 / 空运 / 邮寄）
  2. **数量与成本**：
     - `qty`
     - `unit_price_usd`：订单币种不是 USD 时，`.field-help` 显示 `原币 {currency} {unit_price}，请换算为美元`
     - `purchase_cost_cny_per_unit`
     - `other_cost_cny_per_unit`
     - `fx_cny_per_usd`
     - `intl_freight_usd`
     - `insurance_usd`
     - `us_side_cost_usd`
     - `customs_value_usd`（说明：`报关货值（美元）`）
     - `baseline_duty_rate_pct`（说明：`报价时按此综合税率估算成本（%）`）
     - `target_margin_pct`
  3. **日期**：`quote_date`、`load_date`、`entry_date`、`delivery_date`，都用 `type=date`。说明：`须满足 报价日 ≤ 装船日 ≤ 入境日 ≤ 交货日`。
- **弹窗底部**：
  - `.detail-copy.hint`：`关税订单只保存在本机，由确定性引擎计算，不会发送给模型。`
  - 按钮“取消”和“生成关税订单”（主按钮）。
- **提交**：`POST /convert`，只发送勾选的行。
  - **422**：在对应字段上标红（`.input` 底色改为 `bad-soft`，字段下方用 12px `bad` 色显示 message），同时在弹窗顶部用 `.banner.bad` 列出 `第 {row} 行 · {field} · {message}`。这里的 row 是提交行的序号，要映射回对应的商品卡片。
  - **409**：用 `.banner.bad` 显示后端返回的信息。
  - **成功**：toast `已生成 {imported} 张、更新 {updated} 张关税订单`，关闭弹窗，刷新相关数据。
- 前端**不预先计算**任何金额，只提交用户确认过的值（§0.4 第 2 条）。

### 任务 7.2 订单和客户上的关税信息

- **订单详情**“关税影响”标签页：
  - 数据：`GET /orders/{id}/impacts`。
  - 有数据时显示 `.table`，列为：商品、关税订单号、HS、风险（风险 chip）、利润变化（金额按 `.tone-*` 着色）、决策（决策 chip）、倒计时（倒计时 chip，规则同 MA）。点击一行跳到 `/tariff/inbox?order=`。表格右上角有两个按钮：“更新关税订单”和“同步订单状态”（`POST /sync-status`，结果 toast `已同步 {n} 张关税订单` 或 `关税订单状态已是最新`）。
  - `stale` 为 true 的行，在商品列加一个 `.chip.warn`，文字为 `商品已变更`，title 为 `订单商品已修改，请点击“更新关税订单”重新生成`。生成弹窗中，这类行只读显示。
  - 没有数据时用 `EmptyPanel` 显示 `此订单还没有生成关税订单。`，下方放主按钮“生成关税订单”。
- **订单状态流转之后**：如果这张订单有关联的关税订单，详情顶部显示 `.banner.info`：`订单状态已更新。此订单有 {n} 张关税订单，是否同步状态？`，右侧按钮“同步到关税订单”。
- **客户详情**“关税风险”标签页：
  - 数据：`GET /customers/{id}/impacts`。表格比订单详情多一列“订单号”。
  - 没有数据时显示：`暂无关联的关税订单。可在订单详情中生成，或在风险收件箱中把订单关联到此客户。`
- **客户列表和订单列表卡片**：拉取 `GET /links` 和 `GET /api/tariff/impacts`，在前端按 `tariff_order_id` 关联，找出每个客户或订单的**最高**风险等级（红 > 橙 > 黄 > 绿），显示一个风险 chip，文字为 `关税 {等级}`。这只是查表展示，不算业务计算。

### 任务 7.3 收件箱里的客户（修改 `tariff/inbox/page.tsx`）

- **订单卡片**的 chips 末尾：如果这张关税订单有关联客户，加一个中性 `.chip`，内容是客户名。
- **详情**：
  - `.device-tag` 末尾追加 ` · 客户：{name}`。
  - `.detail-actions` 下方新增一行：`.dropdown` “关联客户”（选项为“不关联”加上客户列表），变更时调用 `PUT /links/{order_id}`。如果这条 link 有 `order_id`，下拉框禁用，并显示链接“查看订单”跳到 `/orders?id=`。
  - 有客户时再加一个链接“查看客户”，跳到 `/customers?id=`。
- MA 原有的快捷键不能受影响：焦点在下拉框里时，Ctrl+Enter、Ctrl+Backspace、Ctrl+D 不能触发决策，与 MA 中输入框的规则一致。

### 任务 7.4 今日简报的关税卡片和对话开关

- 在 `/`（今日简报）的空对话状态中，提示词按钮的**上方**放一张 `.card`，标题为“关税风险摘要”，前置 IconAlertTriangle。数据来自 `GET /summary`。
  - **`opened` 为 false 时**：卡片里只有一行 `.detail-copy`：`本公司尚未启用关税风险模块。`，下面一个 `.btn` “打开关税工作台”（跳到 `/tariff`）。
  - **已启用时**，内容从上到下：
  1. `span.stat-chip`：`{pending} 待处理`、`{red} 红色`、`{urgent} 紧急`、`{drafts_pending} 待审核规则`；
  2. 有日报时：`.detail-copy` 写 `政策日报 {date}：{conclusion}`；
  3. 最多 5 条紧急订单，每行是 `{order_id} · {product} · {customer_name 或 未关联客户}`，右侧是利润变化（按正负着色）和风险 chip，点击跳到收件箱对应订单；
  4. 底部两个 `.learn-link`：“打开风险收件箱”“查看政策日报”。
- 今日简报的提示词再追加一条 `结合关税风险生成今日简报`。点击这一条时，除了填入输入框，还把 `includeTariff` 设为 true，横幅随之显示。
- 6.1 中的“引用关税数据”开关在本阶段完成端到端联调。

### 阶段 7 完成标准

完整走通下面这条流程，并在阶段 8 写成 E2E 测试：

1. 新建客户；
2. 为该客户新建一张 2 个商品的 USD 订单，状态为“已下单”；
3. 在订单详情中生成关税订单（HS 选 `8501.10.40` 和 `9503.00.00`，补全其余字段）；
4. 在订单详情、客户详情、风险收件箱中都能看到这两张关税订单和客户名；
5. 把订单状态改为“已出货”，点击同步后，关税订单状态变为 shipped；
6. 在今日简报中打开关税开关并发送问题，确认请求体中 `include_tariff=true`，且关税审计（流水线页的审计日志）中出现 `CHAT_ORDER_DATA_SENT`。

---

## 11. 阶段 8：测试与验收

### 任务 8.1 E2E 后端 `login-demo/tests/e2e_server.py`

以 `tests/browser_fixture.py` 为模板，命令行参数为 `--port`（缺省 8019）、`--web`（缺省 `web/out`）。启动流程：

1. 用 `tempfile.mkdtemp()` 建一个临时数据目录，进程退出时删除。
2. 设置环境变量：`TARIFF_COLLECTOR_MODE=fixture`、`TARIFF_AS_OF_DATE=2026-10-31`、`TARIFF_SCHEDULER_ENABLED=false`。
3. 调用 `create_app(path, "e2e-secret", model_transport=MockTransport(...), osint_runner=stub, hermes_runner=stub, web_dir=--web)`。
   - `MockTransport` 需要处理两个主机：
     - `api.deepseek.com`：返回 SSE，内容为两段 `reasoning_content` 加两段 `content`，最后是 `[DONE]`。最近一次的请求体保存到 `app.state.e2e_last_model_request`，供测试断言。
     - `api.tavily.com`：返回固定的搜索结果，写法照 `browser_fixture.py`。
   - `osint_runner`：返回 `{"overall_rating": "medium", "overall_score": 55, "layers": {"whois": {...}, "mx": {...}}, "flags": ["示例风险标记"], "recommendations": ["核对公司注册信息"]}`。`research_api.deep_research` 会用前两个字段拼出摘要，前端读取 `details.layers/flags/recommendations`。
   - `hermes_runner`：返回 `【E2E Hermes】已完成工具调用。`。
4. 预置两个账号：`e2e@example.com` 和 `e2e-other@example.com`，密码都是 `e2e-password-1`。
   - 第一个账号：设置公司资料；建 2 个客户（`Acme GmbH`（德国，A 级）和 `Globex LLC`（美国，B 级））；写入对话模型的加密 Key，写法照 `browser_fixture.py`；再用同样的方法写入加密的 Tavily Key（`research_settings` 表）。没有 Tavily Key 时，搜索接口会返回 409。
   - **不要**配置关税模型，让 MA 的流程走 fixtures。
5. 只增加一个测试辅助接口：在 `e2e_server.py` 里定义一个 `APIRouter`，提供 `GET /api/__e2e/last-model-request`，返回 `app.state.e2e_last_model_request`。通过 `create_app(..., extra_routers=[router])` 传入。必须走这个参数，因为 `mount_spa` 的兜底路由会拦截之后注册的所有 `/api/*` GET 请求（任务 1.9）。**生产代码中不得出现这个路由。**

### 任务 8.2 Playwright 配置

- **`web/scripts/e2e-server.mjs`**：
  1. 如果环境变量 `E2E_SKIP_BUILD` 不等于 `1`，先运行 `npm run build:export`，并带上环境变量 `NEXT_PUBLIC_ENABLE_GALLERY=1`。
  2. 用 `login-demo/.venv` 中的 python 启动 `../tests/e2e_server.py --port 8019 --web out`。Python 解释器路径优先取环境变量 `PYTHON`。
- **组件展示页**：`src/app/dev/components/page.tsx` 原来的判断是 `if (process.env.NODE_ENV !== "development") notFound();`。改为“非开发环境**且** `process.env.NEXT_PUBLIC_ENABLE_GALLERY !== "1"` 时才返回 404”。这样正式构建仍然返回 404，而 E2E 构建能打开展示页；MA 的 `workflow.spec.ts` 和 `a-v03.spec.ts` 都要访问 `/dev/components`。
- **`web/playwright.config.ts`**：
  - `baseURL` 为 `http://127.0.0.1:8019`，`webServer` 指向上面的脚本，健康检查 URL 为 `http://127.0.0.1:8019/api/tariff/health`。
  - `workers: 1`，`viewport 1440×900`，`reducedMotion: "reduce"`。
  - `globalSetup`：通过 UI 登录 `e2e@example.com`，把 `storageState` 保存到 `e2e/.auth/state.json`；`use.storageState` 指向这个文件，这样 `request` fixture 也会带上登录 cookie。
- **迁移 MA 的 22 项**：把 `e2e-pending/*.spec.ts` 移到 `e2e/`，文件名保持 MA 原样（字母序决定执行顺序），然后修改：
  - 页面路径：按 §2.3 改成 `/tariff/...`；
  - API 常量：改为 `http://127.0.0.1:8019/api/tariff`；
  - `page.route("**/api/…")` 改为 `"**/api/tariff/…"`；
  - 语言切换用例中的页面清单，补上 ST 的主要页面；
  - 模型接入用例改到 `/settings?tab=tariff`；
  - `zz-v02.spec.ts` 第 126 行附近和 `a-v03.spec.ts` 第 160 行附近的图片夹具路径 `../../backend/fixtures/import/order_sheet_sample.png`，改为 `../../mariner/resources/backend/fixtures/import/order_sheet_sample.png`（相对 `web/e2e/`）。
- **新增 ST 用例**：放在 `e2e/zzzz-trade-*.spec.ts`，保证排在 MA 用例之后执行，至少覆盖：
  1. **登录与注册**：未登录访问 `/customers` 时跳到 `/login?next=/customers`，登录后回到 `/customers`；退出后再访问也会跳登录；注册新账号后进入今日简报。
  2. **公司切换与隔离**：添加公司 B 并切换过去后，客户列表为空；收件箱中的关税数据是新的一份（O5 状态为 pending）；切回原公司后数据还在。
  3. **客户**：新增、编辑、搜索、按等级筛选、删除；导入 CSV（用一个临时文件）；导出时触发下载事件，文件名为 `customers.csv`。
  4. **订单**：在客户详情中新增一张两个商品的订单；按“已下单”→“已出货”流转状态；“打印报价单”打开的新页面包含 `QUOTATION`。
  5. **阶段 7 完成标准中的完整打通流程**（含 `include_tariff` 断言：通过 `/api/__e2e/last-model-request` 检查 system 消息中包含“关税风险模块的最新结果”）。
  6. **对话**：在今日简报发送一条消息，思考面板出现并收起，正文显示模拟回复；关闭 Hermes 开关后可以走流式；“停止”可用；在对话记录中能打开和删除。正在回复时点击“+ 新对话”，出现 BUSY 提示。
  7. **文档库**：新建库、上传 `tests/fixtures/product-spec.txt`、查看文字、下载、删除；模板模式下新建模板、生成、复制。
  8. **背调**：搜索公开信息后得到成功报告，并显示来源；深度背调显示检测层和风险标记；删除报告。
  9. **定时任务**：用模板新建任务、立即执行，运行记录出现“成功”并能查看结果；暂停任务；删除任务。
  10. **设置**：保存对话模型名；在关税模型页填写配置并测试连接（用 `page.route` 拦截，写法同 MA）；保存公司资料；保存业务记忆；Tavily 配置。
  11. **语言**：切换到 EN 后，ST 的每个页面标题和导航都显示英文，刷新后仍然是英文。
  12. **布局**：在 1280×800 视口下逐页检查 `document.documentElement.scrollWidth <= 1280`，即没有横向滚动。
- **截图**：每个页面在 1440×900 下截一张图，存为 `login-demo/artifacts/screenshots/bridge-<页面>.png`。还需要两张状态图：`bridge-convert-dialog.png`（生成关税订单弹窗）、`bridge-chat-thinking.png`（思考中的对话）。

### 任务 8.3 样式检查脚本 `web/scripts/check-style.mjs`

并入 `npm run lint`，检查以下两项，任何一项命中都要报错退出：

1. `src/app/trade.css` 中出现 `#[0-9a-fA-F]{3,8}\b`、`rgb(` 或 `hsl(`。
2. `src/**/*.tsx` 中，除 i18n 文件外的字符串字面量里出现 `\p{Extended_Pictographic}`，也就是 emoji。

### 阶段 8 完成标准（也是整个项目的验收清单）

- [ ] `login-demo/` 下 `python -m pytest tests -q` 全部通过，并汇报总数。
- [ ] `ruff check` 通过。
- [ ] `web/` 下 `npm run lint`（含样式检查）、`npm run typecheck`、`npm run test`、`npm run build:export` 全部通过。
- [ ] `npx playwright test` 全部通过：MA 的 22 项迁移用例，加上至少 12 项新用例。
- [ ] 截图齐全。逐张对照任务 4.7 的设计约束，问题都已修正。
- [ ] 附录 B.1 和 B.2 的每一项都打勾。
- [ ] 只启动 FastAPI（不启动 node）、访问 `http://127.0.0.1:8017/` 时，完整功能可用。

---

## 12. 阶段 9：收尾

### 任务 9.1 删除旧前端

1. 删除以下文件：`login-demo/static/` 下的 `index.html`、`app.js`、`app.css`、`workspace.html`、`workspace.js`、`workspace.css`、`api.js`、`sse.js`、`chat-state.js`、`thinking.js`。还有 `login-demo/tests_js/` 整个目录，以及 `login-demo/package.json`（它只用来跑 tests_js）。
2. 如果 `login-demo/static/` 变成空目录，就删除这个目录，同时在 `app.py` 中去掉 `/static` 挂载。`/original-static` 挂载保留，因为模板文件下载还要用。
3. 在 `tests/test_app.py` 中删除对 `/static/app.css` 和 `/static/app.js` 的断言。
4. 在 `login-demo/` 下运行 `rg -n "workspace\.js|/static/|tests_js"`，确认没有残留引用。文档里提到的历史内容可以保留。

### 任务 9.2 启动脚本

- **`login-demo/scripts/dev.ps1`**：参数 `-Fixture`。加上 `-Fixture` 时，设置 `TARIFF_COLLECTOR_MODE=fixture`、`TARIFF_AS_OF_DATE=2026-10-31`、`TARIFF_SCHEDULER_ENABLED=false`。然后：
  1. 启动后端：`.venv\Scripts\python -m uvicorn app:app --reload --host 127.0.0.1 --port 8017`；
  2. 启动前端：`npm --prefix web run dev`；
  3. 日志写到 `login-demo/artifacts/`；按 Ctrl+C 时结束这两个进程（写法参考 `MA:scripts/dev.ps1`）。
- **`login-demo/scripts/dev.sh`**：同样的功能，参数为 `--fixture`。
- **`login-demo/scripts/build-web.ps1`** 和 `build-web.sh`：执行 `npm --prefix web ci`，再执行 `npm --prefix web run build:export`。

### 任务 9.3 README

重写 `login-demo/README.md`：

- 保留“数据和隔离”和“配置 AI”等章节中仍然准确的内容，删除旧前端的说明。
- 新增章节：
  1. **架构**：一个 FastAPI 进程加 Next.js 静态前端；关税模块来自 Mariner AI（MIT），并注明许可声明文件的位置。
  2. **环境要求**：Python 3.12+、Node.js（满足 Next 16 的要求）。
  3. **安装**：后端 venv 和 pip；前端 `npm ci`、`npx playwright install chromium`。
  4. **启动**：演示模式先构建前端再只启动后端，打开 `http://127.0.0.1:8017/`；开发模式用 `scripts/dev.ps1 -Fixture`，打开 `http://127.0.0.1:3000/`。
  5. **环境变量表**：`LOGIN_DEMO_SECRET`、`TRADE_ALLOWED_ORIGINS`、`TARIFF_COLLECTOR_MODE`、`TARIFF_AS_OF_DATE`、`TARIFF_SCHEDULER_ENABLED`、`TARIFF_SEED_SAMPLE_ORDERS`、`TRADE_BACKEND`（只在前端开发模式下使用）。
  6. **关税模块**：功能概览；数据存放在 `data/tariff/`；每天 07:30 自动运行；关税模型在“设置 → 关税智能体模型”中单独配置；订单数据只会在三种经过同意的情况下外发（§0.4 第 3 条）。
  7. **打通功能**：从订单生成关税订单、客户关税风险、收件箱关联客户、对话引用关税数据。
  8. **测试**：pytest、vitest、Playwright 的运行命令。
  9. **备份**：需要同时保留 `data/accounts.sqlite3`、`data/model-encryption.key` 和 `data/tariff/`。
- `login-demo/docs/TradeAI使用说明书.*` 不在本次范围内，不要修改。只在 README 中注明“说明书截图为旧版界面”。

### 任务 9.4 进度记录

- 在本文件末尾“进度”一节，把每个阶段勾选掉，并写上日期、测试数量和遗留问题。
- 列出 `docs/superpowers/questions/2026-11-01-mariner-bridge.md` 中所有未关闭的 Q。

---

## 附录 A：接口清单

### A.1 ST 原有接口（行为不变，前端全部要用到）

| 分组 | 接口 |
|---|---|
| 账号 | `POST /api/register`、`POST /api/login`、`POST /api/logout`、`GET /api/me`、`GET /api/workspace` |
| 公司 | `GET /api/companies`、`POST /api/companies`、`POST /api/companies/{id}/select`、`GET /api/company`、`PUT /api/company` |
| 客户 | `GET /api/customers?q&tier&country&limit&offset`（返回 `{items,total}`）、`POST /api/customers`、`GET/PUT/DELETE /api/customers/{id}`、`GET /api/customers/export`、`POST /api/customers/import`（body 为 `{content}`）、`GET /api/customers/{id}/libraries`、`POST/DELETE /api/customers/{id}/libraries/{lid}` |
| 订单 | `GET /api/orders`、`POST /api/orders`、`GET/PUT/DELETE /api/orders/{id}`、`GET /api/orders/{id}/quotation`（返回 HTML） |
| 文档 | `GET/POST /api/libraries`、`POST /api/libraries/{id}/scan`、`GET/POST /api/libraries/{id}/files`、`GET /api/documents/{id}/download`、`GET /api/documents/{id}/text`、`DELETE /api/documents/{id}` |
| 模板 | `GET/POST /api/templates`、`PUT/DELETE /api/templates/{id}`、`POST /api/templates/{id}/render`（body 为 `{company,customer,products,contact}`） |
| 对话 | `GET/PUT /api/model-settings`、`GET/PUT /api/memory`、`GET /api/chat/skills`、`GET/POST /api/conversations`、`GET/DELETE /api/conversations/{id}`、`POST /api/conversations/{id}/cancel`、`POST /api/conversations/{id}/stream`（SSE）、`POST /api/conversations/{id}/hermes` |
| 背调 | `GET/PUT /api/research/settings`、`POST /api/research/search`、`POST /api/research/deep`、`GET /api/research/reports`、`GET/DELETE /api/research/reports/{id}` |
| 任务 | `GET/POST /api/automations`、`GET/PUT/DELETE /api/automations/{id}`、`POST /api/automations/{id}/run`、`GET /api/automation-runs` |

本方案对 ST 原有接口唯一的改动：`ChatInput` 新增字段 `include_tariff`（任务 2.2）。

### A.2 打通接口 `/api/trade-tariff/*`（新增，ST 风格错误格式）

见任务 2.1 的接口表：`summary`、`hts-options`、`links`、`links/{id}`、`orders/{id}/draft`、`orders/{id}/convert`、`orders/{id}/sync-status`、`orders/{id}/impacts`、`customers/{id}/impacts`。

### A.3 关税接口 `/api/tariff/*`（MA 原接口，前缀变化，MA 风格错误格式）

`health`、`meta`、`orders`、`orders/import`、`runs`、`runs/latest`、`impacts`、`impacts/{order_id}`、`impacts/{order_id}/decision`、`decisions`、`audit`、`rules/snapshot`、`watch-items`、`briefs`、`briefs/latest`、`briefs/{date}`、`pipeline/runs`、`pipeline/runs/latest`、`pipeline/runs/{id}`、`rule-drafts`、`rule-drafts/{id}`、`rule-drafts/{id}/review`、`settings/llm`（GET/PUT/DELETE）、`settings/llm/test`、`kb`（GET/POST）、`kb/{key}`（GET/PUT/DELETE）、`kb/{key}/restore`、`kb/{key}/undelete`、`chat/conversations`（GET/POST）、`chat/conversations/latest`、`chat/conversations/{key}`（GET/DELETE）、`chat/conversations/{key}/messages`、`import-jobs`（POST）、`import-jobs/{key}`、`import-jobs/{key}/consent`、`import-jobs/{key}/rows`（PUT）、`import-jobs/{key}/commit`、`import-jobs/{key}/cancel`，以及 `openapi.json`。

请求和响应结构见 `MA:docs/API.md`、`MA:docs/V02_SPEC.md` §5.4、§6.3、§6.5。

---

## 附录 B：功能对照清单（验收时逐项打勾）

### B.1 ST 旧界面功能 → 新位置

- [x] 注册、登录、退出、刷新后恢复登录、401 自动跳到登录页 → `/login`、AuthGate
- [x] 公司下拉切换、添加公司（创建后切换过去）、公司设置（含 target_region、agent_identity_md）→ 顶栏 CompanySwitcher、`/settings?tab=company`
- [x] 8 个对话入口，每个都有标题、技能标签、介绍、3 个提示词 → `/`、`/chat?ctx=`
- [x] 关联客户、参考文档、联网搜索（默认开）、Hermes 工具（默认开）、新对话 → 6.1
- [x] Enter 发送、Shift+Enter 换行、停止、思考面板（推理流、耗时文字）、来源链接 → 6.1
- [x] Hermes 模式、“继续”类请求识别（`shouldUseHermesTools`）、工具请求失败后的重试（`force_tools`）→ 6.1
- [x] 未配置 Key 时提示并跳到设置；回复进行中禁止新开对话、打开其他对话、删除该对话 → 6.1、6.7
- [x] 客户列表、搜索、等级筛选、添加和编辑（全部字段）、删除 → 6.2
- [x] 客户详情：字段、备注、关联或取消关联文档库、订单列表、新增和编辑订单、与此客户对话 → 6.2
- [x] CSV 导入（失败整体拒绝，显示错误）、导出 `customers.csv` → 6.2
- [x] 订单新增和编辑：订单号、币种、状态流转、交期、多行商品（单价可留空表示待谈）、付款条款、备注；打印报价单 → 6.3
- [x] 文档库选择、新建库（本地文件夹路径）、扫描文件夹、上传、查看文字、下载 → 6.4
- [x] Tavily 配置、搜索公开信息（可关联客户）、深度背调、报告列表和详情（摘要、风险标记、建议、检测层、来源）→ 6.5、6.8
- [x] 定时任务模板（4 个）、新建和编辑（名称、指令、技能、频率、时间、每周执行日）、立即执行、下次运行时间、最近运行记录及结果 → 6.6
- [x] 对话记录：打开（按技能定位入口）、删除 → 6.7
- [x] 模型设置（模型名、Key 留空则保留）→ 6.8
- [x] 技能目录、新手引导 → 6.9
- [x] 操作反馈 toast、错误提示 → 4.6
- [x] **新增入口（D9）**：删除订单、删除文档、单证模板、业务记忆、删除背调报告、删除任务、任务启停、清除对话模型或搜索的 Key

### B.2 MA 功能 → 新位置（以 `MA:docs/V03_DESIGN.md` §6 为准）

- [x] 侧栏搜索（Ctrl/⌘ K，收件箱内实时过滤，其他页面按 Enter 跳转）、导航计数、今日已处理、中/EN
- [x] 顶栏：税则版本、页面标题、北京时间时钟
- [x] `/tariff` 工作台：统计 chip、日报入口、对话列表（URL 带 `?c=`）、新对话、删除对话、知识引用标签跳转、数字守卫横幅、“对话可使用订单数据”开关及提示、未配置模型横幅、失败重试、附件导入（CSV/XLSX/PDF/图片）、导入确认弹窗、导入预览（可编辑、校验、确认导入、取消）
- [x] `/tariff/inbox`：全部/紧急（`?tab=urgent`）、贸易术语筛选、规则快照、重新计算、导入订单 CSV 对话框、订单卡片（严重度条、标签）、详情（环形图、倒计时、原因、税率和利润说明）、采纳/不处理/需补充及三个快捷键、需补充面板、关键日期时间轴、5 个标签页（建议勾选、税率分层、利润、规则核验、处理链）、临界事件卡片（`#watch-events`）、最近处理表
- [x] `/tariff/brief`：日期选择、生成时间、订单汇总卡片、结论、5 个类型标签页、条目（法律状态、待确认、原文链接、受影响订单）
- [x] `/tariff/knowledge`：类型筛选（含“已删除”）、显示订单数据开关、新建条目、搜索、编辑（分语言）、恢复系统版本、来源已更新横幅、删除和恢复删除、只读条目
- [x] `/tariff/review`：4 个计数、草稿卡片、确认/驳回/需补充、校验结果三栏和“不适用”、原文高亮、预估影响
- [x] `/tariff/pipeline`：状态、触发方式、运行号、立即运行（运行中每 2 秒轮询）、步骤卡片（`?step=`）、kv、九节点流程图、步骤表、审计日志 20 条（不可篡改说明）
- [x] 模型接入（`/settings?tab=tariff`）：状态、模型名、测试结果卡片、保存、测试连接、清除配置、接口格式说明
- [x] 审计链：所有 MA 动作加上 `TRADE_LINK_CHANGED`，中英文标签齐全
- [x] `/dev/components` 在开发环境可用，生产构建中返回 404

---

## 附录 C：环境变量

| 变量 | 作用 | 缺省 |
|---|---|---|
| `LOGIN_DEMO_SECRET` | 会话签名密钥（原有） | 每次进程启动随机生成 |
| `TRADE_ALLOWED_ORIGINS` | 写请求允许的额外 Origin | `http://127.0.0.1:3000,http://localhost:3000` |
| `TARIFF_COLLECTOR_MODE` | `live` / `fixture` | `live` |
| `TARIFF_AS_OF_DATE` | 固定“今天”，格式 YYYY-MM-DD | 空，即按北京时间取当天 |
| `TARIFF_SCHEDULER_ENABLED` | 是否每天 07:30 自动运行 | `true` |
| `TARIFF_SEED_SAMPLE_ORDERS` | 新公司是否导入 O1–O8 示例订单 | `true` |
| `TARIFF_TIMEZONE` | 时区 | `Asia/Shanghai` |
| `TRADE_BACKEND` | 前端开发代理的目标地址（只在 `next dev` 时使用） | `http://127.0.0.1:8017` |
| `NEXT_PUBLIC_ENABLE_GALLERY` | 构建时设为 `1`，生产构建中也开放 `/dev/components`（只供 E2E 使用） | 不设置 |

---

## 附录 D：ST 订单 → 关税订单的预填规则（`GET /orders/{id}/draft`）

每个商品对应一行。下表中“空”表示留给用户填写。前端提交前不做任何计算。

| 字段 | 预填值 |
|---|---|
| `order_id` | 已有 link 时用原值；否则取 `order_no` 去掉非法字符后的结果，`order_no` 为空时用 `ST{订单id}`；订单有多个商品时再加 `-{序号，从 1 开始}`。如果和关税库中别的订单重名，依次追加 `-2`、`-3`… 直到不冲突 |
| `product` | 商品的 `product_name` |
| `hts10` | 空；已有 link 时用原值 |
| `origin` | `CN` |
| `incoterm` | 空 |
| `channel` | `b2b` |
| `importer_of_record` | 空，前端随贸易术语自动设定 |
| `tariff_clause` | `none` |
| `status` | 按任务 2.1 的状态映射 |
| `qty` | 商品的 `quantity`，为空时留空 |
| `unit_price_usd` | 订单币种为 USD 时用商品的 `unit_price`，否则留空 |
| `purchase_cost_cny_per_unit`、`fx_cny_per_usd`、`customs_value_usd`、`baseline_duty_rate_pct`、`target_margin_pct` | 空 |
| `other_cost_cny_per_unit`、`intl_freight_usd`、`insurance_usd`、`us_side_cost_usd` | `0` |
| `transport_mode` | `ocean` |
| `quote_date` | 订单 `created_at` 的日期部分 |
| `load_date`、`entry_date` | 空 |
| `delivery_date` | 订单的 `delivery_date` 符合 `YYYY-MM-DD` 时用它，否则留空 |

已有 link 且关税订单存在时，整行改用关税订单当前的值（`existing=true`）。

---

## 附录 E：已知限制与风险（照实写进 README 的“已知限制”）

1. **ST 对话引用关税数据时，没有 MA 的数字守卫**。只能靠提示词约束模型照抄数字。
2. **DeepSeek 不支持图片**。如果关税模型也配成 DeepSeek，图片或扫描版 PDF 的订单识别会失败，并显示错误信息。需要识别图片时，请配置支持视觉的 OpenAI 兼容模型（U4 的价值所在）。
3. **live 采集模式下，每个公司每天各访问一次联邦公报和 USITC**。公司多的时候请求量会成倍增加（D6）。
4. **生成关税订单时，先写关税库、再写 ST 主库**。两步之间如果失败，只能靠重试补齐 link；重试是幂等的。
5. **ST 后端的错误信息只有中文**（D4）。
6. **不再支持移动端布局**（D8）。
7. **某公司第一次进入关税页面时**，这个请求要同步完成建库、导入种子和首次计算，可能需要几秒钟。期间页面显示加载状态即可。

---

## 进度

- [x] 阶段 1 后端迁入 mariner —— 2026-11-01：后端命名空间迁入、隔离运行时与加密模型配置。
- [x] 阶段 2 深度打通后端 —— 2026-11-01：订单转换、客户关联、状态同步、显式数据授权与审计。
- [x] 阶段 3 伺服前端 —— 2026-11-01：同源静态导出路由、缓存、404/503 和路径保护。
- [x] 阶段 4 前端地基 —— 2026-11-01：Mariner v0.3 原始 CSS、统一认证、导航和双语。
- [x] 阶段 5 MA 页面迁移 —— 2026-11-01：全部 Mariner 页面和 22 项浏览器用例迁移。
- [x] 阶段 6 ST 页面重写 —— 2026-11-01：业务页面 React 重写，15 项原 JS 用例全部迁移。
- [x] 阶段 7 打通界面 —— 2026-11-01：客户订单风险、转换表单、收件箱关联、聊天授权。
- [x] 阶段 8 测试与验收 —— 2026-11-01：150 项后端用例（清理前）与 36 项浏览器用例通过，16 张融合截图完成。
- [x] 阶段 9 收尾 —— 2026-11-01：旧前端已删除，脚本、README、验收报告与 17 张融合截图齐全；最终 149 项后端、15 项单元、36 项浏览器测试通过。


## Execution overrides

- User clarified: use Mariner v0.3 UI throughout; U3 and original tokens remain authoritative.
- Host: workspace smart-trade-ai; source: workspace astra-dev-spec, read-only. Referenced E: drive is unavailable.
- GitHub host HEAD: b59f90c98e4b0f36a1be2acc26853d329e79fbcf. The current Hermes endpoint streams SSE; preserve that newer behavior.

- Local branch: `codex/mariner-bridge`. User subsequently authorized publishing a new repository on their authenticated GitHub account.
- Final review and limitations: `docs/superpowers/2026-11-01-mariner-bridge-review.md`.

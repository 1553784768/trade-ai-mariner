# Trade AI · Mariner v0.3 融合版

业务管理与关税风险分析在同一个应用中运行。前端以 Mariner v0.3 为基础，保留其原色、字体、卡片、侧栏和布局；Smart Trade AI 提供多账号、多公司、客户、订单、文档与业务智能体功能。桌面最小宽度为 1280px。

## 架构与许可

生产运行只需一个监听 `127.0.0.1:8017` 的 FastAPI 进程。Next.js 静态导出位于 `web/out/`，由 FastAPI 同源提供；开发模式使用 Next 代理 `/api/*`。原项目根目录的应用仍独立保留。

关税模块来自 Mariner AI（MIT），许可分别保留在 `mariner/LICENSE-MARINER`、`web/LICENSE-MARINER`；宿主沿用 AGPL-3.0。关税数字由 `mariner/engine/` 的确定性引擎计算，前端不重新计算关税。

## 环境与安装

Python 3.12+，Node.js 20.9+（建议 22 或 24），npm。以下命令在 `login-demo/` 中执行：

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -r requirements-dev.txt
npm --prefix web ci
Set-Location web
npx playwright install chromium
Set-Location ..
```

## 启动

离线关税演示（使用固定日期和本地政策夹具）：

```powershell
./scripts/build-web.ps1
$env:TARIFF_COLLECTOR_MODE = 'fixture'
$env:TARIFF_AS_OF_DATE = '2026-10-31'
$env:TARIFF_SCHEDULER_ENABLED = 'false'
.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8017
```

打开 http://127.0.0.1:8017/ 并注册账号。此模式下关税模块可以使用内置示例；业务对话仍需配置真实模型。测试服务器另有完全模拟的业务模型，不会冒充真实服务。

开发模式：`./scripts/dev.ps1 -Fixture`，打开 http://127.0.0.1:3000/。日志在 `artifacts/`，Ctrl+C 结束两个开发服务。Linux/macOS 对应 `bash scripts/dev.sh --fixture` 和 `bash scripts/build-web.sh`。

构建后不要使用 `next start`；静态导出由 FastAPI 提供。缺失导出时服务明确返回 503。正式构建不启用组件展示页。

## 数据和隔离

注册账号拥有独立 workspace，可添加多个公司。客户、订单、文档库、背调报告、任务和会话按公司隔离；业务模型、业务记忆、关税模型配置按 workspace 保存。

每个公司的关税数据库为 `data/tariff/w{workspace_id}/c{company_id}.sqlite3`。首次进入关税页面或生成关税订单才创建；浏览普通业务页面不会自动创建。默认包含 O1–O8 示例订单，可关闭种子订单开关。公司切换清空前端缓存；未改变会话的响应不重写 cookie，避免旧请求覆盖新公司选择。

## 配置 AI

“设置 → 对话模型”配置 DeepSeek 模型名与 API Key。“设置 → 关税智能体模型”单独配置 OpenAI 兼容接口地址、模型与 Key，支持测试连接、清除配置；与业务模型互不影响。密钥通过 workspace 绑定加密存储，接口不返回明文。

业务对话支持推理流、停止、历史恢复、来源、参考文档与客户上下文。Hermes 工具默认开启，需要本机 Hermes 环境；关闭后使用直接模型流。Tavily Key 在“设置 → 联网搜索”配置。联网搜索、真实模型、Hermes、WHOIS 等外部服务需要有效配置与网络；离线自动化验收不证明它们在你的账号下可用。

## 关税模块与业务打通

保留关税工作台、风险收件箱、政策日报、知识库、规则审核、采集流水线、审计链、多模态订单导入和独立模型配置。默认实时采集；每天北京时间 07:30 只处理已经启用关税模块的公司。

订单详情的“关税风险”可生成关税订单：逐商品补齐 HTS、成本、税率基准、日期和合同条款，提交后创建关联并计算风险。重复提交更新已有订单；订单商品发生变化会提示重新检查；订单状态可同步。客户详情汇总关联风险，收件箱可关联独立导入订单的客户。

模型可能收到订单数据的授权入口有三处：关税工作台“对话可使用订单数据”、文件识别确认弹窗、业务聊天“引用关税风险数据”。聊天开关默认关闭，用户开启才追加确定性引擎结果，发送时写入公司的 `CHAT_ORDER_DATA_SENT` 审计记录。

## 环境变量

| 变量 | 默认 / 用途 |
|---|---|
| `LOGIN_DEMO_SECRET` | 随机会话签名密钥；固定值可让重启后会话继续有效 |
| `TRADE_ALLOWED_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000`；额外允许的写请求来源，逗号分隔 |
| `TARIFF_COLLECTOR_MODE` | `live`，离线演示设 `fixture` |
| `TARIFF_AS_OF_DATE` | 当前日期；固定演示设 `2026-10-31` |
| `TARIFF_SCHEDULER_ENABLED` | `true`；演示与测试设 `false` |
| `TARIFF_SEED_SAMPLE_ORDERS` | `1`；设 `0` 不导入示例订单 |
| `TRADE_BACKEND` | `http://127.0.0.1:8017`；仅开发代理使用 |

## 测试与验收

```powershell
.venv/Scripts/python -m pytest tests -q
.venv/Scripts/python -m ruff check
Set-Location web
npm run lint
npm run typecheck
npm test
npx playwright test
npm run build:export
```

Playwright 自动构建并启动临时隔离数据库，监听 127.0.0.1:8019。政策、搜索、模型和背调均使用本地夹具；浏览器和测试服务阻断外部访问。截图位于 `artifacts/screenshots/bridge-*.png`。E2E 构建开启组件展示页，因此完成测试后须重新执行普通 `build:export` 才作为正式产物。

## 备份与限制

同时备份 `data/accounts.sqlite3`、`data/model-encryption.key`、`data/tariff/` 和上传的文档目录。丢失密钥文件后，已有模型 Key 无法恢复，需要重新配置。备份 SQLite 时停止服务或使用 SQLite 在线备份功能。

双语切换覆盖界面；用户数据、模型输出及部分宿主后端错误保留原语言。原 `docs/TradeAI使用说明书.*` 未修改，其中截图为旧版界面。关税结果用于辅助审核；规则与示例数据日期以界面显示为准。
已知限制：业务聊天引用关税结果仅通过提示词要求照抄数字，未接入关税工作台的数字守卫。图片与扫描 PDF 识别需要支持视觉的关税模型；DeepSeek 文本接口不能识别图片。实时采集按公司分别执行，请求量随已启用公司数增长。订单转换先写关税库再写业务主库，若关联写入失败需重试，幂等处理可补齐关联。首次启用公司关税库会同步导入与计算，可能等待数秒。

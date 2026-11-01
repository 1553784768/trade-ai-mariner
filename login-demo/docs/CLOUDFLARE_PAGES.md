# Cloudflare Pages 网页发布

本仓库的 `login-demo/web` 是融合版 Next.js 前端，生产构建已使用静态导出。Cloudflare Pages 可以发布这些网页；账号登录、数据库、关税计算、文件和 AI 对话仍依赖 Python 后端。仅发布前端时，登录页可以打开，但不能完成真实登录和后续业务操作。

在 Cloudflare 控制台 Workers & Pages → 创建应用 → Pages → 导入现有 Git 仓库中使用：

| 配置 | 值 |
|---|---|
| GitHub 仓库 | `1553784768/trade-ai-mariner` |
| 项目名称 | `trade-ai-full-demo`（若已被占用可调整） |
| 生产分支 | `main` |
| 根目录 | `login-demo/web` |
| 框架预设 | Next.js (Static HTML Export)，或 None 后手填下面两项 |
| 构建命令 | `npm run build:export` |
| 输出目录 | `out` |
| Node.js 环境变量 | `NODE_VERSION=24` |

`wrangler.jsonc` 声明输出目录 `out`，不是 `.next`。选择 Git 集成发布后，后续推送到生产分支会触发重新构建。

前端当前调用同站点 `/api/*`，并使用 `/original-static/*` 的部分资源。要启用业务功能，后续需增加可信的 Pages Function / Worker 代理到实际 Python 后端，处理 Origin、会话 Cookie 和流式响应。`TRADE_BACKEND` 只作用于本地开发代理，生产静态导出不会读取它来自动代理。

GitHub 应用授权可仅选择本仓库和关税版仓库 `1553784768/mariner-ai`。不要上传 `login-demo/data/`、本机 `.env` 或模型密钥。

部署后使用 Cloudflare 实际提供的域名验证 `/login`、静态资源与刷新路由。只有网页构建成功不等于完整业务已上线；在后端接入前，不承诺登录、业务管理或 AI 对话可用。

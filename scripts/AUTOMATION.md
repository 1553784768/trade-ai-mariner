# 打火机开发信跟进 — 自动发信链路

四个脚本一条链，权责分开：**出稿 → 判定 → 发信 → 记账**。出稿永远不碰网络，
发信永远不重新出稿（失败的步骤不会被静默丢掉）。

```
campaign_run.py draft   ──► followup_engine.py run      出稿（.eml / DIGEST / manifest.json）
                            send_gate.py preflight      判定每封能不能发 → SENDS_TODAY.json
campaign_run.py send    ──► send_via_gmail.py           Gmail API 发信 + 回写台账
campaign_setup.py       ──► 身份 / 授权 / 自测 / arm    设置与体检
```

## 文件

| 文件 | 作用 |
|---|---|
| `scripts/followup_engine.py` | 按 D0/D3/D7/D14/D30 渲染草稿，写 `manifest.json`（机器可读）与人类可读的 DIGEST / SEND_BATCH |
| `scripts/send_gate.py` | 唯一判定层。读 manifest，输出 allowed / blocked 及原因，写 `SENDS_TODAY.json` 与 `audit.log` |
| `scripts/send_via_gmail.py` | 唯一传输层。只发闸门放行的，逐封回写 `sent.json`（带 provider message id） |
| `scripts/campaign_run.py` | 编排：draft / send / status / reconcile |
| `scripts/campaign_setup.py` | 一次配好：署名、Google 授权、自测邮件、arm / disarm、check |

数据目录：`login-demo/data/outbox-lighters/`
（`FOLLOWUP_OUTBOX` 环境变量可指向沙箱，测试时务必设置，否则会写生产 outbox）

## 闸门规则（每条都是阻断，不是建议）

- `STOP` 文件存在 → 当天一封不发
- `AUTOSEND_ARMED` 不存在 → 当天一封不发（**默认就是不发**）
- `sender_profile.json` 缺 `sender_name / sender_company / sender_email / postal_address` → 不发
- 只发 A 级；B/C 只出稿
- 只发 D0 / D3 / D14 / D30；D7 是 LinkedIn 私信，永远手动
- 同一 (客户, 步骤) 永远不会发第二次
- 同一域名一天最多一封；每天上限 5 封（`--max`）
- 正文里必须出现邮寄地址 + 退订句，否则不发
- 平台页 / 目录页 / 同行域名一律拒发

## 配置（三个前置条件，缺一不发）

1. **署名与合规信息**（CAN-SPAM 要求真实邮寄地址）

   ```
   python scripts/campaign_setup.py --name "姓名" --company "Company EN" \
       --phone "+1 ..." --email "you@yourdomain.com" \
       --address "真实邮寄地址"
   ```

2. **Google 授权**（OAuth，不需要密码，token 存 `%LOCALAPPDATA%\hermes\google_token.json`）

   在 Google Cloud Console 建一个 OAuth 客户端（Desktop app），下载 JSON，然后：

   ```
   python scripts/campaign_setup.py --client-secret C:/path/client_secret.json
   python scripts/campaign_setup.py --auth-url        # 把输出的 URL 在浏览器里打开并授权
   python scripts/campaign_setup.py --auth-code "http://localhost:1/?code=..."   # 粘回跳转后的整条 URL
   ```

   浏览器会停在 `http://localhost:1` 打不开的页面 —— 这是正常的，复制地址栏整条 URL。

   控制台里的点击路径（一次性，约 5 分钟，必须用要发信的 Google 账号登录）：

   1. https://console.cloud.google.com/projectselector2/home/dashboard → 新建项目
   2. https://console.cloud.google.com/apis/library → 启用 **Gmail API**（只发信不需要别的 API）
   3. https://console.cloud.google.com/auth/audience → Test users → 把自己这个 Gmail 加进去
      （不加会拿到 `Error 403: access_denied`）
   4. https://console.cloud.google.com/apis/credentials → Create Credentials
      → OAuth client ID → Application type: **Desktop app** → Create → Download JSON
   5. `--client-secret` 指向下载到的 `client_secret_*.json`（不要手抄内容）

   scope 只需要发信：`--auth-url` 默认按 `email` 服务集申请。

3. **自测 + 上膛**

   ```
   python scripts/campaign_setup.py --selftest     # 把一封草稿发到你自己邮箱，看排版
   python scripts/campaign_setup.py --check        # 应为 RESULT: READY
   python scripts/campaign_setup.py --arm          # 只有前三项都通过才会成功
   ```

   撤销自动发信：`python scripts/campaign_setup.py --disarm`（出稿照旧，一封不发）

## 每日节奏

| 时间 | 任务 | 做什么 |
|---|---|---|
| 08:45 | `lighter-draft-0845` | 出稿 + 闸门判定，把清单发到对话里；不发信 |
| 09:00 | `lighter-send-0900` | 按清单发信，回写 message id；未授权就如实报告未发送 |

要中止当天：09:00 前回复「停」，或在 outbox 里建一个空文件 `STOP`。
要长期停：把 `lighter-send-0900` 暂停（保留 08:45 出稿）。

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| `ABORT: AUTOSEND_ARMED missing` | 正常态，还没上膛：`--arm` |
| `ABORT: sender_profile.json missing: ...` | 补署名：见上第 1 步 |
| `google transport not ready: Not authenticated` | 没授权：见上第 2 步 |
| `Not authenticated. Run the setup script first` 且 setup.py 报 `Run this script in the Hermes environment` | `setup.py` 需要 `PYTHONPATH=<hermes-home>/hermes-agent`；`campaign_setup.py` 已自动加，直接调 setup.py 才需要手动加 |
| 某封发失败 | 台账里是 `failed`，步骤不会自动重发。修好原因后 `campaign_run.py reconcile` 看清单，`--apply` 释放这些步骤，下一次 `draft` 会重新出稿 |
| 同一天跑了两次 draft | 第二次不会清空 manifest（已修），闸门仍能读到当天的全部草稿 |

## 已知边界

- 传输只支持 Google（Gmail API）。本机 Hermes 没有 Gmail/Outlook 的 connector slug，Outlook 需要另做 MS Graph 通道。
- 仓库把 `auto-smtp-email` skill 列为禁用（`trade/skill_registry.py` 的 `_BLOCKED_SKILLS`），本链路**不触碰**它：没有 smtplib、不读 SMTP 凭据、不经过 skill 路由。
- 收件人里 `info@afgdistribution.com` 只在第三方库出现过，发信前最好电话确认（855-234-4386）。

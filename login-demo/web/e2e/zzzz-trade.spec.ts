import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const artifacts = resolve(__dirname, "../../artifacts/screenshots");
async function shot(page: Page, name: string) {
  if (name !== "chat-thinking") await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, `bridge-${name}.png`) });
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test("login redirect, registration, session restoration and logout", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } }),
    page = await context.newPage();
  await page.goto("http://127.0.0.1:8019/customers");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(`new-${Date.now()}@example.com`);
  await page.getByLabel("密码", { exact: true }).fill("e2e-password-1");
  await page.getByRole("button", { name: "注册", exact: true }).last().click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.getByRole("button", { name: "稍后", exact: true }).click();
  await page.reload();
  await expect(page.locator("h1")).toHaveText("客户管理");
  await page.goto("http://127.0.0.1:8019/settings?tab=account");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("http://127.0.0.1:8019/customers");
  await expect(page).toHaveURL(/\/login\?next=/);
  await context.close();
});

test("company switching preserves independent customer and tariff data", async ({ page, request }) => {
  const original = (await (await request.get("/api/company")).json()).id;
  await page.goto("/customers");
  await page.locator(".org-button").click();
  await page.getByRole("button", { name: "添加公司", exact: true }).click();
  await page.getByRole("dialog").getByLabel("公司名称", { exact: true }).fill("Second E2E company");
  await page.getByRole("dialog").getByRole("button", { name: "添加公司", exact: true }).click();
  await expect(page.locator(".org-button")).toContainText("Second E2E company");
  await expect(page.locator(".metrics-list .metric-card")).toHaveCount(0);
  expect((await (await page.request.get("/api/trade-tariff/status")).json()).opened).toBe(false);
  await page.goto("/tariff/inbox?order=O5");
  await expect(page.getByTestId("decision-state")).toHaveText("待处理");
  await page.request.post(`/api/companies/${original}/select`);
  await page.goto("/customers");
  await expect(page.locator(".metrics-list")).toContainText("Acme GmbH");
});

test("customer editing, search, tiers, CSV import and export", async ({ page }) => {
  await page.goto("/customers");
  await page.getByRole("button", { name: "添加客户", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("客户名称", { exact: true }).fill("Bridge Buyer");
  await dialog.getByLabel("国家", { exact: true }).fill("美国");
  await dialog.getByLabel("客户等级", { exact: true }).selectOption("A");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".trade-detail h2")).toHaveText("Bridge Buyer");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.getByLabel("跟进备注", { exact: true }).fill("Call on Monday");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".kv-table")).toContainText("Call on Monday");
  await page.getByPlaceholder("搜索客户", { exact: true }).fill("Bridge Buyer");
  await page.locator(".filter-row").getByLabel("客户等级").selectOption("A");
  await expect(page.locator(".metrics-list .metric-card")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("customers.csv");
  await page.locator('input[type="file"]').setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,country,tier\nCSV Buyer,美国,B\n"),
  });
  await expect(page.locator(".toast-stack")).toContainText("客户已导入");
  await page.getByPlaceholder("搜索客户", { exact: true }).fill("CSV Buyer");
  await page.locator(".filter-row").getByLabel("客户等级").selectOption("B");
  await page.locator(".metric-card").filter({ hasText: "CSV Buyer" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("客户已删除");
});

test("order UI creates two items and prints a quotation", async ({ page, request }) => {
  const customers = await (await request.get("/api/customers?q=Bridge%20Buyer")).json();
  const cid = customers.items[0].id;
  await page.goto(`/customers?id=${cid}&tab=orders`);
  await page.getByRole("button", { name: "新增订单", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("订单号", { exact: true }).fill("BRIDGE-E2E");
  await dialog.getByLabel("商品名称 1", { exact: true }).fill("Motor");
  await dialog.getByLabel("数量 1", { exact: true }).fill("100");
  await dialog.getByLabel("单价 1", { exact: true }).fill("25");
  await dialog.getByRole("button", { name: "添加商品", exact: true }).click();
  await dialog.getByLabel("商品名称 2", { exact: true }).fill("Toy");
  await dialog.getByLabel("数量 2", { exact: true }).fill("50");
  await dialog.getByLabel("单价 2", { exact: true }).fill("40");
  await dialog.getByRole("button", { name: "保存订单", exact: true }).click();
  await page.getByRole("link", { name: /BRIDGE-E2E/ }).click();
  await expect(page.locator(".table tbody tr")).toHaveCount(2);
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "打印报价单", exact: true }).click();
  const quotation = await popup;
  await expect(quotation.locator("h1")).toContainText("QUOTATION");
  await quotation.close();
  await page.getByRole("button", { name: "已下单", exact: true }).click();
  await expect(page.locator(".device-tag")).toContainText("已下单");
});

test("bridge conversion validates input and links both orders to customer and inbox", async ({
  page,
  request,
}) => {
  const order = (await (await request.get("/api/orders")).json()).find(
    (v: { order_no: string }) => v.order_no === "BRIDGE-E2E",
  );
  await page.goto(`/orders?id=${order.id}&tab=tariff`);
  await page.getByRole("button", { name: "生成关税订单", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".conversion-card")).toHaveCount(2);
  await shot(page, "convert-dialog");
  await dialog.getByRole("button", { name: "生成关税订单", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("第 1 行");
  const samples = await (await request.get("/api/tariff/orders")).json();
  const sample = samples.find((v: { order_id: string }) => v.order_id === "O1");
  for (let index = 0; index < 2; index++) {
    const card = dialog.locator(".conversion-card").nth(index),
      product = index === 0 ? "Motor" : "Toy";
    await card
      .locator("select")
      .nth(0)
      .selectOption(index === 0 ? "8501.10.40" : "9503.00.00");
    await card.getByLabel("贸易术语", { exact: false }).selectOption("DDP");
    for (const key of [
      "qty",
      "unit_price_usd",
      "purchase_cost_cny_per_unit",
      "other_cost_cny_per_unit",
      "fx_cny_per_usd",
      "intl_freight_usd",
      "insurance_usd",
      "us_side_cost_usd",
      "customs_value_usd",
      "baseline_duty_rate_pct",
      "target_margin_pct",
      "quote_date",
      "load_date",
      "entry_date",
      "delivery_date",
    ]) {
      await card.getByLabel(`${product} ${key}`, { exact: true }).fill(String(sample[key]));
    }
  }
  await dialog.getByRole("button", { name: "生成关税订单", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".table tbody tr")).toHaveCount(2);
  const impacts = await (await request.get(`/api/trade-tariff/orders/${order.id}/impacts`)).json();
  expect(impacts).toHaveLength(2);
  await page.goto(`/customers?id=${order.customer_id}&tab=tariff`);
  await expect(page.locator(".table tbody tr")).toHaveCount(2);
  await page.goto(`/tariff/inbox?order=${impacts[0].tariff_order_id}`);
  await expect(page.getByLabel("关联客户", { exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "查看客户", exact: true })).toHaveAttribute(
    "href",
    `/customers?id=${order.customer_id}`,
  );
  await page.goto(`/orders?id=${order.id}&tab=tariff`);
  await page.getByRole("button", { name: "已出货", exact: true }).click();
  await page.getByRole("button", { name: "同步订单状态", exact: true }).click();
  await expect
    .poll(async () => {
      const v = await (await request.get(`/api/trade-tariff/orders/${order.id}/impacts`)).json();
      return v.every((r: { impact: { status: string } }) => r.impact.status === "shipped");
    })
    .toBe(true);
});

test("business chat streams reasoning and explicitly audits tariff data", async ({ page, request }) => {
  await request.get("/api/tariff/meta");
  await page.goto("/");
  await page.getByLabel("Hermes 工具", { exact: true }).uncheck();
  await page.getByLabel("联网搜索", { exact: true }).uncheck();
  await page.getByLabel("引用关税数据", { exact: true }).check();
  await page.getByLabel("消息", { exact: true }).fill("Give me today's tariff briefing");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".thinking")).toBeVisible();
  await shot(page, "chat-thinking");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("当前回复还在进行中");
  await expect(page.locator(".chat-message.assistant")).toContainText("隔离测试响应");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  const captured = await (await request.get("/api/__e2e/last-model-request")).json();
  expect(captured.messages[0].content).toContain("关税风险模块的最新结果");
  expect(
    (await (await request.get("/api/tariff/audit")).json()).some(
      (v: { action: string }) => v.action === "CHAT_ORDER_DATA_SENT",
    ),
  ).toBe(true);
});

test("chat stop, history continuation and deletion", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Hermes 工具", { exact: true }).uncheck();
  await page.getByLabel("联网搜索", { exact: true }).uncheck();
  await page.getByLabel("消息", { exact: true }).fill("Stop this test");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".thinking")).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await page.goto("/history");
  await page.locator(".metric-card").filter({ hasText: "Stop this test" }).click();
  await page.getByRole("link", { name: "继续对话", exact: true }).click();
  await expect(page.locator(".chat-message.user")).toContainText("Stop this test");
  await page.goto("/history");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("对话已删除");
});

test("documents upload, preview, download and delete", async ({ page }) => {
  await page.goto("/documents");
  await page.getByRole("button", { name: "新建文档库", exact: true }).click();
  await page.getByRole("dialog").getByLabel("名称", { exact: true }).fill("Product specs");
  await page.getByRole("dialog").getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator('input[type="file"]').setInputFiles({
    name: "product-spec.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Motor specifications for trade bridge"),
  });
  await expect(page.locator(".trade-preview")).toContainText("Motor specifications");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("product-spec.txt");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("文档已删除");
});

test("document templates render user variables", async ({ page }) => {
  await page.goto("/documents?mode=templates");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await page.getByRole("dialog").getByLabel("模板名称", { exact: true }).fill("Quotation template");
  await page.getByRole("dialog").locator("textarea").fill("Hello {{customer}}, from {{company}}");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await page.getByLabel("公司", { exact: true }).fill("Trade AI");
  await page.getByLabel("客户", { exact: true }).fill("Acme");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.locator(".trade-preview").last()).toHaveText("Hello Acme, from Trade AI");
});

test("research search and deep checks show sources and risk flags", async ({ page }) => {
  await page.goto("/research");
  await page.getByLabel("搜索词", { exact: true }).fill("Acme pumps");
  await page.getByRole("button", { name: "搜索公开信息", exact: true }).click();
  await expect(page.locator(".trade-detail")).toContainText("公开资料");
  await expect(page.getByRole("link", { name: "Acme official site" })).toBeVisible();
  await page.getByLabel("背调类型", { exact: true }).selectOption("deep");
  await page.getByLabel("邮箱或域名", { exact: true }).fill("acme.example");
  await page.getByRole("button", { name: "深度背调", exact: true }).click();
  await expect(page.locator(".trade-detail")).toContainText("示例风险标记");
  await expect(page.locator(".trade-detail")).toContainText("whois");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除报告", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("报告已删除");
});

test("scheduled tasks create, run, pause and delete", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByLabel("任务模板", { exact: true }).selectOption("0");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".trade-detail h2")).toHaveText("每日早安简报");
  await page.getByRole("button", { name: "立即执行", exact: true }).click();
  await expect(page.locator(".trade-detail details")).toHaveCount(1);
  await page.locator(".trade-detail summary").click();
  await expect(page.locator(".trade-detail details")).toContainText("隔离测试响应");
  await page.getByRole("button", { name: "暂停任务", exact: true }).click();
  await expect(page.getByRole("button", { name: "启用任务", exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除任务", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("任务已删除");
});

test("settings persist model, company, search and business memory", async ({ page, request }) => {
  await page.goto("/settings?tab=chat");
  await page.getByLabel("模型名称", { exact: true }).fill("custom-chat-model");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("模型设置已保存");
  await page.getByRole("tab", { name: "公司资料", exact: true }).click();
  await page.getByLabel("目标市场", { exact: true }).fill("US and EU");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await (await request.get("/api/company")).json()).target_region).toBe("US and EU");
  await page.getByRole("tab", { name: "业务记忆", exact: true }).click();
  await page.getByLabel("业务记忆", { exact: true }).fill("Use concise quotations.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get("/api/memory")).json()).content)
    .toBe("Use concise quotations.");
  await page.getByRole("tab", { name: "联网搜索", exact: true }).click();
  await expect(page.getByLabel("当前模型", { exact: true })).toHaveValue("custom-chat-model");
  await expect(page.getByLabel("模型接口地址", { exact: true })).toHaveValue("https://model.example/v1");
  await page.getByLabel("Tavily API Key", { exact: true }).fill("fake-tavily-key");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast-stack")).toContainText("搜索配置已保存");
});

test("sidebar keeps its scroll position across navigation", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator(".sidebar .nav-list");
  const before = await nav.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await nav.locator('a[href="/history"]').click();
  await expect(page).toHaveURL(/\/history$/);
  const after = await nav.evaluate((element) => element.scrollTop);
  expect(after).toBe(before);
});

test("all business screens translate, fit desktop and produce review screenshots", async ({ page }) => {
  const pages = [
    ["daily", "/", "Daily briefing"],
    ["customers", "/customers", "Customers"],
    ["orders", "/orders", "Orders"],
    ["documents", "/documents", "Documents"],
    ["research", "/research", "Customer research"],
    ["tasks", "/tasks", "Scheduled tasks"],
    ["history", "/history", "Chat history"],
    ["settings", "/settings", "Settings"],
  ];
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.reload();
  for (const [name, path, title] of pages) {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveText(title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const chrome = await page.locator(".sidebar,.topbar").allTextContents();
    expect(chrome.join(" ").replaceAll("中", "")).not.toMatch(/[\u3400-\u9fff]/);
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, name);
  }
  await page.getByRole("button", { name: "中", exact: true }).click();
  for (const [name, path] of [
    ["tariff", "/tariff"],
    ["inbox", "/tariff/inbox"],
    ["brief", "/tariff/brief"],
    ["knowledge", "/tariff/knowledge"],
    ["review", "/tariff/review"],
    ["pipeline", "/tariff/pipeline"],
  ]) {
    await page.goto(path);
    await expect(page.locator(".topbar")).toBeVisible();
    await shot(page, name);
  }
});

test("Hermes execution survives client navigation and keeps tool results", async ({ page }) => {
  await page.goto("/chat?ctx=lead");
  await expect(page.getByLabel("Hermes 工具", { exact: true })).toBeChecked();
  await page.getByLabel("联网搜索", { exact: true }).uncheck();
  await page.getByLabel("消息", { exact: true }).fill("查找并核验工业水泵客户的官方网站");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".tool-list")).toContainText("网页搜索");
  await page.locator('.sidebar a[href="/customers"]').click();
  await expect(page.locator("h1")).toHaveText("客户管理");
  await page.locator('.sidebar a[href="/chat?ctx=lead"]').click();
  await expect(page.locator(".chat-message.assistant")).toContainText("已完成客户官网核验");
  await page.locator(".thinking summary").click();
  await expect(page.locator(".tool-list")).toContainText("浏览器操作");
});

test("chat workspaces keep independent conversations", async ({ page }) => {
  await page.goto("/chat?ctx=lead");
  await page.getByLabel("消息", { exact: true }).fill("lead workspace message");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();

  await page.locator('.sidebar a[href="/chat?ctx=customs"]').click();
  await expect(page.locator("h1")).toHaveText("海关数据");
  await expect(page.locator(".chat-message.user")).toHaveCount(0);

  await page.getByLabel("消息", { exact: true }).fill("customs workspace message");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();

  await page.locator('.sidebar a[href="/chat?ctx=lead"]').click();
  await expect(page.locator(".chat-message.user")).toContainText("lead workspace message");
  await expect(page.locator(".chat-message.user")).not.toContainText("customs workspace message");
});

test("chat customer selector groups products and shows ABC tiers", async ({ page }) => {
  await page.goto("/chat?ctx=lead");
  const picker = page.getByLabel("关联客户", { exact: true });
  await picker.click();
  const lighters = page.locator('details.customer-group[data-category="打火机"]');
  const pajamas = page.locator('details.customer-group[data-category="睡衣"]');
  await lighters.locator("summary").click();
  await pajamas.locator("summary").click();
  await expect(lighters.getByRole("option", { name: "Acme GmbH · A 类 · 连锁超市" })).toBeVisible();
  await expect(lighters.getByRole("option", { name: "Globex LLC · B 类 · 打火机批发商" })).toBeVisible();
  await expect(pajamas.getByRole("option", { name: "Pajama World · C 类 · 睡衣零售商" })).toBeVisible();
  await lighters.getByRole("option", { name: /Acme GmbH · A 类 · 连锁超市/ }).click();
  await expect(picker).toContainText("Acme GmbH");
  await expect(page.locator(".chat-options").getByText("A 类", { exact: true })).toBeVisible();
  await expect(page.locator(".chat-options").getByText("连锁超市", { exact: true })).toBeVisible();
});

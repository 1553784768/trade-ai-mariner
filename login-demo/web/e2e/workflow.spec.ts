import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const screenshots = resolve(__dirname, "../../artifacts/screenshots");
async function shot(page: Page, name: string) {
  mkdirSync(screenshots, { recursive: true });
  await expect(page.locator(".topbar-clock")).toContainText(/\d{4}-\d{2}-\d{2}/);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(screenshots, `${name}.png`), fullPage: false });
}

test("milestones: components, inbox, decision, pipeline, review, brief", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/Failed to decode downloaded font|OTS parsing error/.test(message.text()))
      errors.push(message.text());
  });
  await page.goto("/dev/components");
  await expect(page.getByText("−$16,000.00", { exact: false })).toBeVisible();
  await expect(page.getByText("+$1,500.00", { exact: false })).toBeVisible();
  await shot(page, "T-3.2");
  expect(
    await page.evaluate(() =>
      [...document.fonts]
        .filter((f) => f.status === "error" && !f.family.replaceAll('"', "").endsWith("Fallback"))
        .map((f) => f.family),
    ),
  ).toEqual([]);
  await page.goto("/tariff/inbox");
  await expect(page.locator("[data-order]")).toHaveCount(8);
  expect(
    await page.locator("[data-order]").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-order"))),
  ).toEqual(["O5", "O1", "O3", "O6", "O4", "O2", "O8", "O7"]);
  await expect(page.getByRole("link", { name: /风险收件箱/ })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".topbar-org")).toContainText("Trade AI Demo");
  await expect(page.locator(".sidebar a.nav-item")).toHaveCount(20);
  await expect(page.locator(".sidebar a.nav-item").first()).toContainText("今日简报");
  await expect(page.locator(".detail-heading")).toHaveText(
    (await (await request.get("http://127.0.0.1:8019/api/tariff/impacts/O5")).json()).product,
  );
  await expect(page.locator(".detail-panel .device-tag")).toContainText("O5 · HTS");
  await shot(page, "T-4.1");
  await page.getByLabel("贸易术语", { exact: true }).selectOption("ddp");
  await expect(page.locator("[data-order]")).toHaveCount(6);
  await page.getByLabel("贸易术语", { exact: true }).selectOption("all");
  await page.getByRole("tab", { name: /紧急/ }).click();
  const urgent = await (
    await request.get("http://127.0.0.1:8019/api/tariff/impacts?risk=%E7%BA%A2,%E6%A9%99&decision=pending")
  ).json();
  await expect(page.locator("[data-order]")).toHaveCount(urgent.length);
  expect(
    await page.locator("[data-order]").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-order"))),
  ).toEqual(urgent.map((card: { order_id: string }) => card.order_id));
  await page.getByRole("tab", { name: "全部", exact: true }).click();
  await page.locator('[data-order="O5"]').click();
  await expect(page).toHaveURL(/order=O5/);
  await expect(page.locator('[data-order="O5"]')).toContainText("规则边界 9天");
  await shot(page, "T-4.2");
  await page.getByRole("tab", { name: "税率分层", exact: true }).click();
  await expect(page.getByTestId("layers")).toContainText("$10,816.00");
  await expect(page.getByTestId("layers")).toContainText("$26,816.00");
  await expect(page.getByTestId("layers")).toContainText("+$16,000.00");
  await page.getByRole("tab", { name: "利润", exact: true }).click();
  await expect(page.getByTestId("profits")).toContainText("$8,473.57");
  await expect(page.getByTestId("profits")).toContainText("−$7,526.43");
  await page.getByRole("tab", { name: /可执行建议/ }).click();
  await expect(page.locator(".route-entry.selectable")).toHaveCount(4);
  await page.getByRole("tab", { name: "规则核验", exact: true }).click();
  await expect(page.locator(".detail-panel .route-col").nth(1)).toContainText("未核实字段2");
  await shot(page, "T-4.3-1440");
  await page.setViewportSize({ width: 1300, height: 900 });
  await expect(page.locator(".detail-actions")).toHaveCSS("display", "flex");
  await shot(page, "T-4.3-1300");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: /可执行建议/ }).click();
  await page.getByRole("checkbox", { name: "action-1", exact: true }).check();
  await page.locator("h1").click();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("decision-state")).toHaveText("已采纳");
  await expect(page.locator(".history-table")).toContainText("O5");
  await shot(page, "T-4.3-adopted");
  await expect(page.locator("#watch-events .route-col")).toHaveCount(3);
  await expect(page.locator("#watch-events .route-col").filter({ hasText: "机器人" })).toContainText(
    "影响 1 单 · 暂无税率",
  );
  await page.locator("#watch-events").scrollIntoViewIfNeeded();
  await shot(page, "T-4.4");
  await page.getByRole("link", { name: "智能体流水线", exact: true }).click();
  let polls = 0;
  await page.route("**/api/tariff/pipeline/runs/PIPE-*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    polls++;
    await route.fulfill({ response, json: polls === 1 ? { ...data, status: "running" } : data });
  });
  await page.getByRole("button", { name: "立即运行" }).click();
  await expect(page.getByRole("button", { name: "立即运行" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "立即运行" })).toBeEnabled({ timeout: 30000 });
  expect(polls).toBeGreaterThanOrEqual(2);
  // Repeated collection is idempotent; compare this run with its returned counts.
  const latest = await (await request.get("http://127.0.0.1:8019/api/tariff/pipeline/runs/latest")).json();
  const expected = latest.steps.map(
    (step: { counts: { input: number; output: number; skipped: number; errors: number } }) => [
      step.counts.input,
      step.counts.output,
      step.counts.skipped,
      step.counts.errors,
    ],
  );
  const rows = page.getByTestId("pipeline-steps").locator("tbody tr");
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    expect((await rows.nth(i).locator("td").allTextContents()).slice(2, 6).map(Number)).toEqual(expected[i]);
  }
  await shot(page, "T-7.3");
  await page.getByRole("link", { name: /规则审核/ }).click();
  await expect(page.locator("[data-draft]")).toHaveCount(2);
  await page.locator('[data-draft="DRAFT-2026-20511"]').click();
  await page.getByRole("tab", { name: "原文", exact: true }).click();
  await expect(page.getByTestId("source-text").locator("mark")).toHaveCount(4);
  await page.getByRole("tab", { name: "校验结果", exact: true }).click();
  const checks = await (
    await request.get("http://127.0.0.1:8019/api/tariff/rule-drafts/DRAFT-2026-20511")
  ).json();
  expect(checks.validation).toHaveLength(9);
  await expect(page.locator(".route-col .route-entry")).toHaveCount(
    checks.validation.filter((v: { status: string }) => v.status !== "n/a").length,
  );
  await shot(page, "T-7.2");
  await page.getByRole("button", { name: "确认规则", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认规则", exact: true })).toBeDisabled();
  await expect
    .poll(async () => {
      const audit = await (await request.get("http://127.0.0.1:8019/api/tariff/audit")).json();
      return audit.some((e: { action: string }) => e.action === "RULE_APPROVED");
    })
    .toBeTruthy();
  await shot(page, "T-7.2-approved");
  await page.getByRole("link", { name: "政策日报", exact: true }).click();
  await expect(page.getByTestId("brief-items").locator(".card-like")).toHaveCount(9);
  await expect(page.locator("select")).toHaveValue("2026-10-31");
  await shot(page, "T-7.1");
  expect(errors).toEqual([]);
});

test("T-16.11 model settings: save, success, failure and clear without external calls", async ({ page }) => {
  let configured = false,
    failed = false;
  let lastTest: { ok: boolean; message: string; latency_ms: number; at: string } | null = null;
  const settings = () => ({
    configured,
    base_url: configured ? "https://model.example/v1" : null,
    model: configured ? "demo" : null,
    api_key_masked: configured ? "****1234" : null,
    last_test: lastTest,
  });
  await page.route("**/api/tariff/meta?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, llm_configured: configured } });
  });
  await page.route("**/api/tariff/settings/llm?*", async (route) => {
    if (route.request().method() === "PUT") configured = true;
    if (route.request().method() === "DELETE") {
      configured = false;
      lastTest = null;
    }
    await route.fulfill({ json: settings() });
  });
  await page.route("**/api/tariff/settings/llm/test?*", (route) => {
    lastTest = {
      ok: !failed,
      message: failed ? "HTTP 401" : "连接成功",
      latency_ms: 20,
      at: "2026-10-31T12:00:00Z",
    };
    return route.fulfill({ json: lastTest });
  });
  await page.goto("/settings?tab=tariff");
  await page.getByLabel("接口地址").fill("https://model.example/v1");
  await page.getByLabel("API Key").fill("private-1234");
  await page.getByLabel("模型名称").fill("demo");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const modelMetrics = page.locator(".panels.fill .metrics-list .metric-value");
  await expect(modelMetrics.first()).toHaveText("已接入");
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接成功 20 ms")).toBeVisible();
  await expect(modelMetrics.nth(2)).toHaveText("20");
  await shot(page, "T-16.11");
  await shot(page, "T-7.4-success");
  failed = true;
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接失败：HTTP 401 20 ms")).toBeVisible();
  await expect(modelMetrics.nth(2)).toHaveText("连接失败");
  await shot(page, "T-7.4-failed");
  await page.getByRole("button", { name: "清除配置", exact: true }).click();
  await expect(modelMetrics.first()).toHaveText("未接入");
  await expect(modelMetrics.nth(2)).toHaveText("—");
  await shot(page, "T-7.4");
});

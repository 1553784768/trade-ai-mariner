import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const apiBase = "http://127.0.0.1:8019/api/tariff";
const screenshots = resolve(__dirname, "../../artifacts/screenshots");
async function shot(page: Page, name: string) {
  mkdirSync(screenshots, { recursive: true });
  await expect(page.locator(".topbar-clock")).toContainText(/\d{4}-\d{2}-\d{2}/);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(screenshots, `${name}.png`) });
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
});
test("T-16.1 system fonts and offline assets", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) fonts.push(r.url());
  });
  await page.goto("/tariff/brief");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 248, 251)");
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /^-apple-system/,
  );
  expect(fonts).toEqual([]);
});
test("T-16.2 shell, global search and language persistence", async ({ page, request }) => {
  const started = await (await request.post(`${apiBase}/pipeline/runs`)).json();
  await expect
    .poll(async () => (await (await request.get(`${apiBase}/pipeline/runs/${started.id}`)).json()).status)
    .not.toBe("running");
  await page.goto("/tariff/brief");
  await expect(page.locator(".topbar")).toHaveCSS("height", "60px");
  await expect(page.locator(".sidebar")).toHaveCSS("width", "264px");
  await expect(page.locator(".topbar")).toContainText("税则 2026HTSRev22");
  await expect(page.locator(".topbar-org")).toContainText("Trade AI Demo");
  await expect(page.locator(".nav-list .nav-item")).toHaveCount(19);
  await expect(page.locator('.nav-item[href="/tariff/inbox"] .nav-count')).toHaveText("8");
  await expect(page.locator('.nav-item[href="/tariff/review"] .nav-count')).toHaveText("2");
  await expect(page.locator('.nav-item[href="/tariff/brief"]')).toHaveClass(/active/);
  await shot(page, "T-16.2");
  await page.keyboard.press("Control+k");
  const search = page.locator(".sidebar .search-box input");
  await expect(search).toBeFocused();
  await search.fill("O5");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/inbox\?q=O5/);
  await expect(page.locator("[data-order]")).toHaveCount(1);
  await expect(page.locator("[data-order]")).toHaveAttribute("data-order", "O5");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveText("Order Risk Inbox");
});
test("T-16.4 component gallery and SVG geometry", async ({ page }) => {
  await page.goto("/dev/components");
  const rings = page.getByTestId("score-ring");
  await expect(rings).toHaveCount(3);
  expect(Number(await rings.nth(0).locator("[data-progress]").getAttribute("stroke-dashoffset"))).toBeCloseTo(
    98.565,
    1,
  );
  expect(Number(await rings.nth(2).locator("[data-progress]").getAttribute("stroke-dashoffset"))).toBe(0);
  expect(Number(await rings.nth(0).locator("[data-baseline]").getAttribute("data-degrees"))).toBeCloseTo(
    60.84,
    2,
  );
  const timeline = page.getByTestId("timeline").first();
  await expect(timeline).toHaveAttribute("data-range-days", "86");
  const positions = [];
  for (const key of ["quote", "load", "today", "boundary", "entry"])
    positions.push(Number(await timeline.locator(`[data-point="${key}"]`).getAttribute("data-x")));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(positions[0]).toBeCloseTo(30 + (4 / 86) * 840, 4);
  await expect(page.getByTestId("timeline").nth(1).locator('[data-point="boundary"]')).toHaveCount(0);
  await expect(page.getByTestId("timeline").nth(2)).toContainText("已入境");
  await shot(page, "T-16.4");
  await page.getByRole("button", { name: "导入订单 CSV", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "T-16.4-modal");
});
test("T-16.5 inbox layout, tabs, decisions and shortcuts", async ({ page, request }) => {
  await page.goto("/tariff/inbox");
  await expect(page.locator("[data-order]")).toHaveCount(8);
  await expect(page).toHaveURL(/order=O5/);
  await expect(page.getByTestId("score-ring")).toContainText("41.9%");
  await expect(page.locator(".score-status")).toHaveText("红色风险");
  await expect(page.locator(".score-flag.muted")).toHaveText("规则边界 9天");
  await expect(page.locator(".detail-panel .device-tag")).toContainText(
    "B2B · 无关税条款 · 进口商：卖方（DDP）",
  );
  const card = page.locator('[data-order="O5"]');
  await expect(card).toContainText("−$16,000.00");
  await expect(card).toContainText("税率 16.9% → 41.9%");
  await expect(card.locator(".metric-bar i")).toHaveAttribute("style", /width: 41.9%/);
  await expect(card.locator(".metric-bar b")).toHaveAttribute("style", /left: 16.9%/);
  expect(await page.locator(".legend-item").allTextContents()).toEqual([
    "报价日",
    "装船日",
    "今天",
    "规则边界",
    "预计入境日",
  ]);
  await expect(page.getByRole("tab", { name: /可执行建议.*4/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("checkbox", { name: "action-1", exact: true }).check();
  await page.getByRole("checkbox", { name: "action-3", exact: true }).check();
  await expect(page.getByRole("button", { name: "采纳建议（2）" })).toBeEnabled();
  await shot(page, "T-16.5");
  await page.locator("h1").click();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("decision-state")).toHaveText("已采纳");
  await expect(page.locator(".decision-explanation")).toHaveText("已采纳：第 01、03 条");
  await page.getByRole("tab", { name: "规则核验", exact: true }).click();
  await expect(page.locator(".detail-panel .route-col").nth(1)).toContainText("未核实字段2");
  await expect(page.locator(".detail-panel .route-col").first()).toContainText("没有不通过项");
  await page.getByRole("tab", { name: "处理链", exact: true }).click();
  await expect(page.locator(".flow-node.dashed")).toHaveText("报关行复核（含未核实字段时）");
  await expect(page.locator("#watch-events .route-col")).toHaveCount(3);
  await expect(page.getByText("审计日志", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "需补充", exact: true }).click();
  await page.getByLabel("补充说明（必填）").fill("等客户确认是否分摊关税增量");
  await shot(page, "T-16.5-detail");
  await page.getByLabel("补充说明（必填）").press("Escape");
  await page.locator('[data-order="O1"]').click();
  await expect(page.locator(".device-tag")).toContainText("O1");
  const before = await (await request.get(`${apiBase}/decisions`)).json();
  await page.locator("h1").click();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("先勾选要采纳的建议")).toBeVisible();
  expect((await (await request.get(`${apiBase}/decisions`)).json()).length).toBe(before.length);
  await page.goto("/tariff/inbox?tab=urgent");
  await expect(page.getByRole("tab", { name: /紧急/ })).toHaveAttribute("aria-selected", "true");
  const meta = await (await request.get(`${apiBase}/meta`)).json();
  await expect(page.locator("[data-order]")).toHaveCount(meta.counts.urgent);
});
test("T-16.6 workbench layout, statistics and import consent", async ({ page, request }) => {
  const created = await (await request.post(`${apiBase}/chat/conversations`)).json();
  await request.post(`${apiBase}/chat/conversations/${created.id}/messages`, {
    data: { text: "今天有哪些需要关注的政策？" },
  });
  await page.goto(`/tariff?c=${created.id}`);
  await expect(page.locator(".panels.fill")).toHaveCSS("grid-template-columns", "280px 838px");
  const meta = await (await request.get(`${apiBase}/meta`)).json();
  const watches = await (await request.get(`${apiBase}/watch-items`)).json();
  await expect(page.locator(".filter-row .stat-chip b")).toHaveText([
    String(meta.counts.pending),
    String(meta.counts.red),
    String(meta.counts.urgent),
    String(watches.length),
  ]);
  await expect(page.locator(".filter-row .stat-chip").nth(1)).toHaveJSProperty("tagName", "SPAN");
  await expect(page.locator(".workbench-context")).toHaveCount(0);
  await expect(page.locator(".chat .msg.assistant")).toBeVisible();
  await shot(page, "T-16.6");
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      resolve(__dirname, "../../mariner/resources/backend/fixtures/import/order_sheet_sample.png"),
    );
  await expect(page.getByRole("dialog")).toHaveClass("modal");
  await expect(page.locator(".modal-foot button")).toHaveText(["取消", "发送并识别"]);
  await shot(page, "T-16.6-consent");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator('.filter-row a[href="/tariff/inbox?tab=urgent"]').click();
  await expect(page).toHaveURL(/tab=urgent/);
});
test("T-16.7 brief summary and tabs", async ({ page }) => {
  await page.goto("/tariff/brief");
  await expect(page.locator(".metrics-list .metric-card")).toHaveCount(7);
  await expect(page.locator(".metrics-list .metric-value")).toHaveText([
    "8",
    "1",
    "1",
    "2",
    "4",
    "−$16,250.00",
    "$6,000.00",
  ]);
  await expect(page.getByRole("tab", { name: /全部/ }).locator(".tab-count")).toHaveText("9");
  await expect(page.locator(".date-range")).toContainText("生成于");
  await expect(page.locator(".detail-copy.hint")).toHaveText(
    "结论按生成时的订单状态计算，之后的决策和重算不会更新这句话。",
  );
  await shot(page, "T-16.7");
  await page.getByRole("tab", { name: /观察/ }).click();
  await expect(page.getByTestId("brief-items").locator(".route-entry")).toHaveCount(0);
});
test("T-16.8 knowledge edit, delete and restore", async ({ page }) => {
  await page.goto("/tariff/knowledge?id=policy%3A2026-21755");
  await expect(page.getByTestId("knowledge-detail").locator("h2")).toBeVisible();
  await expect(page.getByLabel("类型").locator('option[value="deleted"]')).toHaveText("已删除");
  await shot(page, "T-16.8");
  const original = await page.getByTestId("knowledge-body").innerText();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("正文", { exact: true }).fill("V03 local edit");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("knowledge-body")).toHaveText("V03 local edit");
  await page.getByRole("button", { name: "恢复系统版本", exact: true }).click();
  await expect(page.getByTestId("knowledge-body")).toHaveText(original);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByLabel("类型").selectOption("deleted");
  await expect(page.locator("[data-knowledge]")).toHaveCount(1);
  await page.locator("[data-knowledge]").click();
  await expect(page.getByTestId("deleted-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除", exact: true })).toHaveCount(0);
  await shot(page, "T-16.8-deleted");
  await page.getByTestId("deleted-banner").getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByTestId("deleted-banner")).toHaveCount(0);
});

test("T-16.9 review layout and evidence tabs", async ({ page }) => {
  await page.goto("/tariff/review");
  await expect(page.locator("[data-draft]")).toHaveCount(2);
  await expect(page.locator(".filter-row .stat-chip b")).toHaveText(["2", "0", "0", "0"]);
  await expect(page).toHaveURL(/draft=/);
  await page.locator('[data-draft="DRAFT-2026-20510"]').click();
  await expect(page.locator(".detail-panel .device-tag")).toHaveText("2026-20510");
  await expect(page.locator(".route-col").nth(2)).toContainText("V1 原文引用逐字命中");
  await expect(page.getByText("不适用：V2、V3、V4、V5、V6、V7、V8、V9")).toBeVisible();
  await shot(page, "T-16.9");
  await page.getByRole("tab", { name: "原文", exact: true }).click();
  await expect(page.locator(".source-text .mark").first()).toBeVisible();
  await shot(page, "T-16.9-source");
  await page.getByRole("tab", { name: "预估影响", exact: true }).click();
  await expect(page.locator(".kv dd")).toHaveCount(2);
});

test("T-16.10 pipeline cards, selection, flow and audit", async ({ page, request }) => {
  const data = await (await request.get(`${apiBase}/pipeline/runs/latest`)).json();
  expect(
    data.steps.map((step: { counts: { input: number; output: number; skipped: number; errors: number } }) => [
      step.counts.input,
      step.counts.output,
      step.counts.skipped,
      step.counts.errors,
    ]),
  ).toEqual([
    [20, 20, 0, 0],
    [108, 10, 0, 0],
    [1, 1, 0, 0],
    [30, 23, 7, 0],
    [8, 2, 6, 0],
    [2, 2, 0, 0],
    [1, 1, 0, 0],
  ]);
  await page.goto("/tariff/pipeline");
  await expect(page.locator("[data-step]")).toHaveCount(7);
  await expect(page).toHaveURL(/step=collector_fr/);
  await expect(page.locator(".flow-node.warn").filter({ hasText: "人工确认" })).toHaveText(
    "人工确认 · 2 待确认",
  );
  const rows = page.getByTestId("pipeline-steps").locator("tbody tr");
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 7; i++)
    expect((await rows.nth(i).locator("td").allTextContents()).slice(2, 6).map(Number)).toEqual([
      data.steps[i].counts.input,
      data.steps[i].counts.output,
      data.steps[i].counts.skipped,
      data.steps[i].counts.errors,
    ]);
  await shot(page, "T-16.10");
  await rows.nth(3).click();
  await expect(page).toHaveURL(/step=triage/);
  await expect(page.locator('[data-step="triage"]')).toHaveClass(/active/);
  await page.getByRole("tab", { name: "审计日志", exact: true }).click();
  await expect(page.getByTestId("audit-table").locator("th")).toHaveText(["时间", "动作", "执行者", "摘要"]);
});

test("T-16.12 English screens and desktop layout bounds", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tariff");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  const pages = [
    ["workbench", "/tariff", ".chat-input"],
    ["inbox", "/tariff/inbox?order=O5", ".score-status"],
    ["brief", "/tariff/brief", ".entry-list"],
    ["knowledge", "/tariff/knowledge", ".detail-heading"],
    ["review", "/tariff/review?draft=DRAFT-2026-20510", ".route-grid"],
    ["pipeline", "/tariff/pipeline", "[data-step]"],
    ["settings", "/settings?tab=tariff", ".detail-left.form"],
  ];
  for (const [name, url, ready] of pages) {
    await page.goto(url);
    await expect(page.locator(ready).first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const controls = await page
      .locator(".sidebar,.topbar,.filter-row,.tabs-row,.detail-actions,.field label")
      .allTextContents();
    expect(controls.join(" ").replaceAll("中", "")).not.toMatch(/[\u3400-\u9fff]/);
    await shot(page, `T-16.12-${name}`);
    for (const width of [1280, 1440, 1890]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator(".panels.fill").boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBe(292);
      expect(bounds!.width).toBe(width - 320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  expect(errors).toEqual([]);
});

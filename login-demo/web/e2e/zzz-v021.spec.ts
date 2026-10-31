import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const api = "http://127.0.0.1:8019/api/tariff";
async function shot(page: Page, task: string) {
  const folder = resolve(__dirname, "../../artifacts/screenshots");
  mkdirSync(folder, { recursive: true });
  await expect(page.locator(".topbar-clock")).toContainText(/\d{4}-\d{2}-\d{2}/);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(folder, `${task}.png`) });
}

test("failed assistant shows Retry and resends the same question", async ({ page, request }) => {
  const { id } = await (await request.post(api + "/chat/conversations")).json();
  const questions: string[] = [];
  await page.route("**/api/tariff/chat/conversations/*/messages*", async (route) => {
    const question = route.request().postDataJSON().text;
    questions.push(question);
    const error = questions.length === 1;
    const stamp = new Date().toISOString();
    const message = { citations: [], guard: null, import_job_id: null, created_at: stamp, error: false };
    await route.fulfill({
      json: {
        user: { ...message, id: `u${questions.length}`, role: "user", text: question },
        assistant: {
          ...message,
          id: `a${questions.length}`,
          role: "assistant",
          text: error ? "无法连接模型服务" : "你好",
          error,
        },
      },
    });
  });
  await page.goto(`/tariff?c=${id}`);
  const input = page.getByPlaceholder("输入问题，或上传订单文件…");
  await input.fill("今日政策变化");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".msg.error")).toContainText("无法连接模型服务");
  await expect(page.locator(".msg.error")).toHaveCSS("color", "rgb(163, 37, 59)");
  await shot(page, "T-15.4");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".msg.assistant, .msg.error")).toHaveCount(2);
  expect(questions).toEqual(["今日政策变化", "今日政策变化"]);
  await expect(page.locator(".msg.user")).toHaveCount(2);
});

test("conversation selection persists in URL and deletion opens next conversation", async ({
  page,
  request,
}) => {
  const ids: string[] = [];
  for (const text of ["V021 first conversation", "V021 second conversation"]) {
    const { id } = await (await request.post(api + "/chat/conversations")).json();
    ids.push(id);
    await request.post(`${api}/chat/conversations/${id}/messages`, { data: { text } });
  }
  await page.goto(`/tariff?c=${ids[1]}`);
  await page
    .getByRole("button", { name: /V021 first conversation/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`c=${ids[0]}`));
  await expect(page.locator(".msg.user")).toHaveText("V021 first conversation");
  await page.reload();
  await expect(page.locator(".conv-item[data-active=true]")).toContainText("V021 first conversation");
  await expect(page.locator(".msg.user")).toHaveText("V021 first conversation");
  await shot(page, "T-15.5");
  await page
    .getByRole("button", { name: /V021 second conversation/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`c=${ids[1]}`));
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe("确定删除这段对话吗？");
    return dialog.accept();
  });
  await page.locator(".conv-item[data-active=true]").hover();
  await page.getByRole("button", { name: "删除 V021 second conversation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`c=${ids[0]}`));
  await expect(page.locator(".conv-text").filter({ hasText: "V021 second conversation" })).toHaveCount(0);
});

test("system knowledge deletion appears under Deleted and can be restored", async ({ page }) => {
  await page.goto("/tariff/knowledge?id=policy%3A2026-21755");
  await expect(page.locator("[data-testid=knowledge-detail] h2")).toBeVisible();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(
      "删除后，这条内容不再出现在知识库列表和对话中，可在「已删除」中恢复。不影响订单、规则和关税计算。确定删除吗？",
    );
    return dialog.accept();
  });
  await page
    .locator("[data-testid=knowledge-detail]")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page).not.toHaveURL(/policy%3A2026-21755/);
  await page.getByLabel("类型", { exact: true }).selectOption("deleted");
  await expect(page.locator("[data-knowledge]")).toHaveCount(1);
  await page.locator("[data-knowledge]").click();
  await expect(page.getByTestId("deleted-banner")).toContainText("已删除");
  await shot(page, "T-15.6");
  await page.getByTestId("deleted-banner").getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByTestId("deleted-banner")).toHaveCount(0);
  await page.getByLabel("类型", { exact: true }).selectOption("");
  await expect(page.locator("[data-knowledge].active")).toBeVisible();
  await shot(page, "T-15.6-restored");
});

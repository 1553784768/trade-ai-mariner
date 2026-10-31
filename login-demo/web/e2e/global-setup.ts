import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
export default async function setup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${config.projects[0].use.baseURL}/login`);
  await page.getByLabel("邮箱", { exact: true }).fill("e2e@example.com");
  await page.getByLabel("密码", { exact: true }).fill("e2e-password-1");
  await page.getByRole("button", { name: "登录", exact: true }).last().click();
  await page.waitForURL(config.projects[0].use.baseURL + "/");
  await page.locator(".topbar").waitFor();
  await page.evaluate(() => localStorage.setItem("trade.onboarded.1", "1"));
  mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
}

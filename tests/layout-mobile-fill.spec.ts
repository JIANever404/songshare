import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function readShellWidth(page: Page) {
  return page.getByRole("heading", { name: "我的歌单你听吗" }).evaluate((node) => {
    return node.closest("main > div.relative.z-10, div.relative.z-10")?.getBoundingClientRect().width ?? 0;
  });
}

test("歌曲填写页保持移动端单列宽度，桌面端维持窄列居中", async ({ page }) => {
  await page.goto("/song");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");

  const mobileWidth = await readShellWidth(page);
  expect(mobileWidth).toBeGreaterThan(330);
  expect(mobileWidth).toBeLessThanOrEqual(390);
  await expect(page.getByRole("button", { name: "添加歌曲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清空" })).toHaveCount(0);

  mkdirSync("screenshot", { recursive: true });
  await page.screenshot({ path: "screenshot/layout-song-mobile.png", fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.waitForLoadState("networkidle");

  const desktopWidth = await readShellWidth(page);
  expect(desktopWidth).toBeGreaterThanOrEqual(390);
  expect(desktopWidth).toBeLessThanOrEqual(430);

  await page.screenshot({ path: "screenshot/layout-song-desktop.png", fullPage: true });
});

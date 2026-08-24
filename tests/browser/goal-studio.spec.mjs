import { test, expect } from "@playwright/test";


async function openGoalStudio(page) {
  await page.locator('[data-result-tab="goal-studio"]').click();
  await expect(page.locator('[data-result-panel="goal-studio"]')).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#goal-studio-status")).toContainText("evaluated", { timeout: 25_000 });
}


test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#room-window-source")).toBeVisible();
});


test("evaluates a goal at a movable, keyboard-accessible floor zone", async ({ page }) => {
  test.setTimeout(45_000);
  await openGoalStudio(page);

  const score = Number(await page.locator("#goal-score-value").textContent());
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);
  await expect(page.locator("#goal-reference-date")).toContainText("21 Jun 2025");
  await expect(page.locator("#goal-timeline")).toBeVisible();
  expect(await page.locator(".goal-suggestion-card").count()).toBeGreaterThan(0);

  const originalReadout = await page.locator("#goal-probe-readout").textContent();
  let goalRequestCount = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/goal-studio")) goalRequestCount += 1;
  });
  await page.locator("#goal-probe-map").focus();
  for (let index = 0; index < 6; index += 1) {
    await page.locator("#goal-probe-map").press("ArrowRight");
  }
  await expect(page.locator("#goal-probe-readout")).not.toHaveText(originalReadout);
  await expect(page.locator("#goal-studio-status")).toContainText("evaluated", { timeout: 25_000 });
  expect(goalRequestCount).toBe(1);
});


test("switches goals, applies a measured suggestion, and carries the probe into 3D", async ({ page }) => {
  test.setTimeout(45_000);
  await openGoalStudio(page);
  await page.locator('[data-goal-preset="summer_protection"]').click();
  await expect(page.locator("#goal-studio-status")).toContainText("Summer protection evaluated", { timeout: 12_000 });
  await expect(page.locator("#goal-suggestion-list")).toContainText("goal is already met");

  await page.locator('[data-goal-preset="winter_warmth"]').click();
  await expect(page.locator("#goal-studio-status")).toContainText("Winter warmth evaluated", { timeout: 12_000 });

  const windowsBefore = await page.locator('[name="windows_json"]').inputValue();
  const eavesBefore = await page.locator('[name="scene_eaves_enabled"]').inputValue();
  await page.locator(".goal-suggestion-card").first().getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle", { timeout: 12_000 });
  await expect(page.locator("#goal-studio-status")).toContainText("evaluated", { timeout: 12_000 });
  const windowsAfter = await page.locator('[name="windows_json"]').inputValue();
  const eavesAfter = await page.locator('[name="scene_eaves_enabled"]').inputValue();
  expect(windowsAfter !== windowsBefore || eavesAfter !== eavesBefore).toBe(true);

  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  await expect(viewer).toHaveAttribute("data-goal-probe-visible", "true");
  await expect(viewer).toHaveAttribute("data-goal-probe-position", /\d+\.\d{3},\d+\.\d{3}/);
});

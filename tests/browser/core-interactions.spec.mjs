import { test, expect } from "@playwright/test";

async function waitForPreview(page) {
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");
}

async function dragBy(page, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 6 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#room-window-source")).toBeVisible();
  expect(await page.locator("#simulation-form").evaluate((form) => form.checkValidity())).toBe(true);
});

test("keeps the core editor visible at a laptop viewport", async ({ page }) => {
  const shell = await page.locator(".page-shell").boundingBox();
  const editor = await page.locator(".selected-window-card").boundingBox();

  expect(shell).not.toBeNull();
  expect(editor).not.toBeNull();
  expect(shell.width).toBeLessThanOrEqual(1089);
  expect(editor.y + editor.height).toBeLessThanOrEqual(1200);
});

test("window marker stays on top and dragging persists through refresh", async ({ page }) => {
  const handle = page.locator("#room-window-source");
  const handleBox = await handle.boundingBox();
  const topElementId = await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.id || "";
  }, {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  });
  expect(topElementId).toBe("room-window-source");

  const positionInput = page.locator('input[name="window_span_center"]');
  const originalPosition = await positionInput.inputValue();
  await dragBy(page, handle, -70, 0);

  await expect(positionInput).not.toHaveValue(originalPosition);
  await waitForPreview(page);
  const persisted = await page.locator('input[name="windows_json"]').inputValue();
  expect(JSON.parse(persisted)[0].span_center).toBe(Number(await positionInput.inputValue()));
});

test("resize handles update and persist the selected window width", async ({ page }) => {
  const widthInput = page.locator('input[name="window_width"]');
  const originalWidth = await widthInput.inputValue();
  await dragBy(page, page.locator("#room-window-resize-start"), 45, 0);

  await expect(widthInput).not.toHaveValue(originalWidth);
  await waitForPreview(page);
  const persisted = await page.locator('input[name="windows_json"]').inputValue();
  expect(JSON.parse(persisted)[0].width).toBe(Number(await widthInput.inputValue()));
});

test("tabs, window selection, and room facing remain interactive", async ({ page }) => {
  for (const tabName of ["sunlight-map", "long-range", "outdoor-year", "current"]) {
    const tab = page.locator(`[data-result-tab="${tabName}"]`);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-result-panel="${tabName}"]`)).toHaveAttribute("aria-hidden", "false");
  }

  await page.getByRole("button", { name: "Window 2" }).click();
  await expect(page.locator("#selected-window-wall")).toHaveValue("east");
  await expect(page.locator("#window-position-label")).toContainText("depth axis");

  await page.locator('[data-window-facing="E"]').click();
  await waitForPreview(page);
  await expect(page.locator("#window-facing-input")).toHaveValue("E");
  await expect(page.locator("#snapshot-window-fact")).toContainText("Room front wall faces E");
});

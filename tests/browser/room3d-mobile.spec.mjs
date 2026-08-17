import { test, expect } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#room-window-source")).toBeVisible();
});

test("brings the model forward and keeps playback below it", async ({ page }) => {
  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  await expect(viewer.locator("canvas")).toBeVisible();

  await expect.poll(async () => (await viewer.boundingBox())?.y ?? 9999).toBeLessThan(180);
  const viewerBox = await viewer.boundingBox();
  const readingBox = await page.locator("#room3d-reading").boundingBox();
  const animationBox = await page.locator("#room3d-animation-controls").boundingBox();
  expect(readingBox.y).toBeGreaterThan(viewerBox.y + viewerBox.height);
  expect(animationBox.y).toBeGreaterThan(readingBox.y + readingBox.height);
  expect(animationBox.y).toBeGreaterThan(viewerBox.y + viewerBox.height);
  await expect(page.locator(".furniture-tools")).not.toHaveAttribute("open", "");
  await expect(page.locator("#room3d-reading-state")).toContainText("direct sun reaches the floor");
});

test("uses an explicit touch interaction mode without trapping scroll", async ({ page }) => {
  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  const touchToggle = viewer.locator(".room3d-touch-toggle");

  await expect(touchToggle).toBeVisible();
  await expect(viewer).toHaveAttribute("data-touch-interaction", "scroll");
  await expect(viewer).toHaveCSS("touch-action", "pan-y pinch-zoom");
  await expect(viewer.locator("canvas")).toHaveCSS("touch-action", "pan-y pinch-zoom");

  await touchToggle.click();
  await expect(touchToggle).toHaveAttribute("aria-pressed", "true");
  await expect(viewer).toHaveAttribute("data-touch-interaction", "active");
  await expect(viewer).toHaveCSS("touch-action", "none");
  await expect(viewer.locator("canvas")).toHaveCSS("touch-action", "none");

  await touchToggle.click();
  await expect(viewer).toHaveAttribute("data-touch-interaction", "scroll");
  await expect(viewer.locator("canvas")).toHaveCSS("touch-action", "pan-y pinch-zoom");
});

test("opens touch interaction automatically while arranging furniture", async ({ page }) => {
  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  await page.locator(".furniture-tools > summary").click();
  await page.locator("#furniture-arrange-button").click();

  await expect(viewer).toHaveAttribute("data-arrange-mode", "true");
  await expect(viewer).toHaveAttribute("data-touch-interaction", "active");
  await page.locator("#furniture-add-button").click();
  await page.locator('[data-add-furniture="table"]').click();
  await expect(viewer).toHaveAttribute("data-furniture-count", "3");
  await expect(page.locator("#furniture-selection-editor")).toBeVisible();

  await page.locator("#furniture-arrange-button").click();
  await expect(viewer).toHaveAttribute("data-arrange-mode", "false");
  await expect(viewer).toHaveAttribute("data-touch-interaction", "scroll");
  await expect(viewer).toHaveCSS("touch-action", "pan-y pinch-zoom");
  await expect(viewer.locator(".room3d-touch-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("keeps labels separate and offers an in-view edit action", async ({ page }) => {
  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  const labels = viewer.locator(".room3d-window-label:visible");
  await expect(labels).toHaveCount(2);

  const [first, second] = await labels.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(first.height).toBeGreaterThanOrEqual(44);
  expect(second.height).toBeGreaterThanOrEqual(44);
  const overlap = first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
  expect(overlap).toBe(false);

  await labels.nth(1).click();
  await expect(viewer).toHaveAttribute("data-selected-window", "side_window");
  const editButton = page.locator("#room3d-edit-selected-window");
  await expect(editButton).toBeVisible();
  await editButton.click();
  await expect(page.locator("#selected-window-wall")).toBeFocused();
  await expect.poll(async () => {
    const box = await page.locator(".selected-window-card").boundingBox();
    return box ? box.y < 844 && box.y + box.height > 0 : false;
  }).toBe(true);
});

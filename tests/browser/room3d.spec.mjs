import { test, expect } from "@playwright/test";

async function open3dRoom(page) {
  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  await expect(viewer.locator("canvas")).toBeVisible();
  return viewer;
}

async function dragCanvas(page, canvas, deltaX, deltaY) {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.45;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#room-window-source")).toBeVisible();
});

test("lazy-loads the current room and sunlight in WebGL", async ({ page }) => {
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "idle");
  await expect(viewer.locator("canvas")).toHaveCount(0);

  await open3dRoom(page);

  await expect(viewer).toHaveAttribute("data-window-count", "2");
  await expect(viewer).toHaveAttribute("data-room-size", "4,5,3");
  await expect(viewer).toHaveAttribute("data-rendering", "true");
  await expect(page.locator("#room3d-status")).toContainText("2 windows");
});

test("orbits, resets, and toggles walls", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const canvas = viewer.locator("canvas");
  const initialCamera = await viewer.getAttribute("data-camera-position");

  await dragCanvas(page, canvas, 130, -45);
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(initialCamera);

  await page.locator("#room3d-reset-camera").click();
  await expect.poll(() => viewer.getAttribute("data-camera-position")).toBe(initialCamera);

  await page.locator("#room3d-toggle-walls").click();
  await expect(page.locator("#room3d-toggle-walls")).toHaveAttribute("aria-pressed", "false");
  await expect(viewer).toHaveAttribute("data-walls-visible", "false");
  await expect(viewer.locator("canvas")).toBeVisible();
});

test("supports keyboard orbit, pan, and zoom", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const canvas = viewer.locator("canvas");
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await expect(canvas).toHaveAttribute("aria-describedby", "room3d-keyboard-help");

  const initialCamera = await viewer.getAttribute("data-camera-position");
  await canvas.press("ArrowLeft");
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(initialCamera);

  const initialTarget = await viewer.getAttribute("data-camera-target");
  await canvas.press("Shift+ArrowRight");
  await expect.poll(() => viewer.getAttribute("data-camera-target")).not.toBe(initialTarget);

  const cameraBeforeZoom = await viewer.getAttribute("data-camera-position");
  await canvas.press("+");
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(cameraBeforeZoom);
});

test("permanently tears down a viewer after WebGL context loss", async ({ page }) => {
  const viewer = await open3dRoom(page);
  await viewer.locator("canvas").dispatchEvent("webglcontextlost");

  await expect(viewer).toHaveAttribute("data-viewer-state", "fallback");
  await expect(viewer).toHaveAttribute("data-viewer-destroyed", "true");
  await expect(viewer).toHaveAttribute("data-rendering", "false");
  await expect(viewer.locator("canvas")).toHaveCount(0);

  await page.locator('[data-result-tab="current"]').click();
  await page.locator('[data-result-tab="room-3d"]').click();
  await expect(viewer).toHaveAttribute("data-rendering", "false");
  await expect(viewer).toHaveAttribute("data-viewer-state", "fallback");
});

test("keeps the camera while live room dimensions update", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const defaultCamera = await viewer.getAttribute("data-camera-position");
  await dragCanvas(page, viewer.locator("canvas"), -90, 20);

  await page.locator(".geometry-details > summary").click();
  const depthInput = page.locator('input[name="room_depth"]');
  await depthInput.fill("5.5");
  await depthInput.press("Tab");
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");

  await expect(viewer).toHaveAttribute("data-room-size", "4,5.5,3");
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(defaultCamera);
});

test("falls back cleanly when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SUNLIGHT_FORCE_WEBGL_FAILURE__ = true;
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "fallback");
  await expect(viewer).toContainText("3D is unavailable");
  await expect(viewer.locator("canvas")).toHaveCount(0);

  await page.locator('[data-result-tab="current"]').click();
  await expect(page.locator("#room-window-source")).toBeVisible();
});

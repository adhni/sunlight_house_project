import { test, expect } from "@playwright/test";

test("offers touch activation when a touchscreen is not the primary pointer", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query === "(pointer: coarse)") {
        return {
          matches: false,
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent() { return true; },
        };
      }
      if (query === "(any-pointer: coarse)") {
        return {
          matches: true,
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent() { return true; },
        };
      }
      return nativeMatchMedia(query);
    };
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#room-window-source")).toBeVisible();
  await page.locator('[data-result-tab="room-3d"]').click();

  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  await expect(viewer).toHaveAttribute("data-touch-interaction", "scroll");
  await expect(viewer.locator(".room3d-touch-toggle")).toBeVisible();

  const canvas = viewer.locator("canvas");
  await expect(canvas).toHaveCSS("touch-action", "pan-y pinch-zoom");
  const cameraBeforeTouchDrag = await viewer.getAttribute("data-camera-position");
  const touchBox = await canvas.boundingBox();
  const touchStart = {
    pointerId: 17,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: touchBox.x + touchBox.width * 0.5,
    clientY: touchBox.y + touchBox.height * 0.5,
  };
  await canvas.dispatchEvent("pointerdown", touchStart);
  await canvas.dispatchEvent("pointermove", {
    ...touchStart,
    clientX: touchStart.clientX + touchBox.width * 0.2,
  });
  await canvas.dispatchEvent("pointerup", { ...touchStart, button: 0, buttons: 0 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await viewer.getAttribute("data-camera-position")).toBe(cameraBeforeTouchDrag);

  const cameraBeforeMouseDrag = await viewer.getAttribute("data-camera-position");
  const canvasBox = await canvas.boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.65, canvasBox.y + canvasBox.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(cameraBeforeMouseDrag);
  await expect(viewer).toHaveAttribute("data-touch-interaction", "scroll");
});

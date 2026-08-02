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
});

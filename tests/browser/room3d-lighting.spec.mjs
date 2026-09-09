import { test, expect } from "@playwright/test";

test("sun lighting and optional beams follow cached playback without rebuilding the room", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-result-tab="room-3d"]').click();
  const viewer = page.locator("#room3d-container");
  await expect(viewer).toHaveAttribute("data-viewer-state", "ready");
  await expect(page.locator("#room3d-play")).toBeEnabled();
  const builds = await viewer.getAttribute("data-scene-build-count");
  const initialDirection = await viewer.getAttribute("data-sun-direction");
  const dayAmbient = Number(await viewer.getAttribute("data-ambient-intensity"));
  expect(Number(await viewer.getAttribute("data-sun-intensity"))).toBeGreaterThan(0);
  await expect(viewer).toHaveAttribute("data-beams-visible", "false");

  await page.locator(".room3d-display-options > summary").click();
  const beams = page.locator("#room3d-toggle-beams");
  await beams.click();
  await expect(beams).toHaveAttribute("aria-pressed", "true");
  await expect(viewer).toHaveAttribute("data-beams-visible", "true");
  await page.locator(".room3d-display-options > summary").click();
  await page.locator('[data-room3d-time-preset="noon"]').click();
  await expect(viewer).not.toHaveAttribute("data-sun-direction", initialDirection);
  await expect(viewer).toHaveAttribute("data-beams-visible", "true");

  await page.locator("#room3d-time-slider").fill("0");
  await expect(viewer).toHaveAttribute("data-sun-intensity", "0.0000");
  expect(Number(await viewer.getAttribute("data-ambient-intensity"))).toBeLessThan(dayAmbient / 2);
  await expect(viewer).toHaveAttribute("data-patch-count", "0");
  await page.locator('[data-room3d-time-preset="morning"]').click();
  await expect.poll(async () => Number(await viewer.getAttribute("data-sun-intensity"))).toBeGreaterThan(0);
  await expect(viewer).toHaveAttribute("data-beams-visible", "true");
  await expect(viewer).toHaveAttribute("data-scene-build-count", builds);
  await page.locator(".room3d-display-options > summary").click();
  await beams.click();
  await expect(beams).toHaveAttribute("aria-pressed", "false");
  await expect(viewer).toHaveAttribute("data-beams-visible", "false");
});

test("rendered floor shadows survive cutaways and the hidden roof blocks overhead sun", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { createRoom3DViewer } = await import("/static/room3d.bundle.js");
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;inset:0;width:600px;height:600px";
    document.body.append(container);
    const viewer = createRoom3DViewer({ container });
    const snapshot = { room_vector: [0, 1, 1], patches: [], window_intensities: [], state: "floor_hit" };
    viewer.update({
      room: { width: 4, depth: 5, height: 3 },
      windows: [{ name: "north-window", wall: "north", center_xyz: [2, 5, 1.5], width: 2, height: 2, sill_height: 0.5 }],
      window_facing_label: "N",
      snapshot,
      scene: {},
    });
    viewer.setCameraPreset("top");
    viewer.windowGroup.visible = false;
    viewer.floorGridGroup.visible = false;
    viewer.orientationGroup.visible = false;
    // Sample actual framebuffer pixels on the floor, with no analytical overlays.
    const brightnessAt = (x, z) => {
      viewer.renderer.shadowMap.needsUpdate = true;
      viewer.renderer.render(viewer.scene, viewer.camera);
      const point = viewer.camera.position.clone().set(x, 0, z).project(viewer.camera);
      const gl = viewer.renderer.getContext();
      const px = Math.floor((point.x * 0.5 + 0.5) * gl.drawingBufferWidth);
      const py = Math.floor((point.y * 0.5 + 0.5) * gl.drawingBufferHeight);
      const pixels = new Uint8Array(4 * 25);
      gl.readPixels(px - 2, py - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0) / 75;
    };
    const litOpening = brightnessAt(0, -1);
    const closedWalls = brightnessAt(-1.5, -1);
    viewer.toggleWalls();
    const cutawayWalls = brightnessAt(-1.5, -1);
    viewer.shadowGroup.visible = false;
    const withoutBlockers = brightnessAt(-1.5, -1);
    viewer.shadowGroup.visible = true;
    viewer.updateSunlightFrame({ ...snapshot, room_vector: [0, 0, 1] });
    const underRoof = brightnessAt(0, 0);
    viewer.shadowGroup.visible = false;
    const withoutRoof = brightnessAt(0, 0);
    viewer.shadowGroup.visible = true;
    viewer.updateSunlightFrame({ ...snapshot, room_vector: [0, 1, -1] });
    const night = brightnessAt(-1.5, -1);
    viewer.destroy();
    container.remove();
    return { litOpening, closedWalls, cutawayWalls, withoutBlockers, underRoof, withoutRoof, night };
  });
  expect(result.litOpening).toBeGreaterThan(result.closedWalls + 20);
  expect(Math.abs(result.closedWalls - result.cutawayWalls)).toBeLessThan(2);
  expect(result.withoutBlockers).toBeGreaterThan(result.cutawayWalls + 20);
  expect(result.withoutRoof).toBeGreaterThan(result.underRoof + 20);
  expect(result.night).toBeLessThan(result.closedWalls * 0.6);
});

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
  await expect(viewer).toHaveAttribute("data-opening-count", "3");
  await expect(viewer).toHaveAttribute("data-door-count", "1");
  await expect(viewer).toHaveAttribute("data-door-wall", "south");
  await expect(viewer).toHaveAttribute("data-door-visible", "false");
  await expect(viewer).toHaveAttribute("data-internal-wall-count", "1");
  await expect(viewer).toHaveAttribute("data-eave-count", "4");
  await expect(viewer).toHaveAttribute("data-external-obstruction-count", "0");
  await expect(viewer).toHaveAttribute("data-external-obstruction-preset", "none");
  await expect(viewer).toHaveAttribute("data-sunlight-blocker-count", "5");
  await expect(viewer).toHaveAttribute("data-furniture-count", "2");
  await expect(viewer).toHaveAttribute("data-furniture-preset", "living");
  await expect(viewer).toHaveAttribute("data-furniture-visible", "true");
  await expect(viewer).toHaveAttribute("data-context-visible", "true");
  await expect(viewer).toHaveAttribute("data-scene-visual-only", "false");
  await expect(viewer).toHaveAttribute("data-front-facing", "NE");
  await expect(viewer).toHaveAttribute("data-axis-convention", "east-positive-x north-negative-z");
  await expect(viewer).toHaveAttribute("data-selected-window", "main_window");
  await expect(viewer).toHaveAttribute("data-wall-panel-count", /[1-9]\d*/);
  await expect(viewer).toHaveAttribute("data-room-size", "4,5,3");
  await expect(viewer).toHaveAttribute("data-rendering", "true");
  await expect(page.locator("#room3d-status")).toContainText("furniture remains scale-only");
  await expect(page.locator(".room3d-compass-key-north")).toHaveText("N · true north");
  await expect(page.locator(".room3d-compass-key-front")).toHaveText("Front · NE");
  await expect(page.locator('.room3d-window-label[data-window-name="main_window"]')).toHaveText("Window 1");
  await expect(page.locator('.room3d-window-label[data-window-name="side_window"]')).toHaveText("Window 2");

  const room = (await viewer.getAttribute("data-room-size")).split(",").map(Number);
  const appWindows = JSON.parse(await viewer.getAttribute("data-window-geometry"));
  const threeWindows = JSON.parse(await viewer.getAttribute("data-window-geometry-three"));
  threeWindows.forEach((windowGeometry, index) => {
    expect(windowGeometry.name).toBe(appWindows[index].name);
    expect(windowGeometry.x).toBeCloseTo(appWindows[index].center[0] - room[0] / 2, 3);
    expect(windowGeometry.z).toBeCloseTo(room[1] / 2 - appWindows[index].center[1], 3);
  });
  const cameraPosition = (await viewer.getAttribute("data-camera-position")).split(",").map(Number);
  expect(cameraPosition[0]).toBeLessThan(0);
  expect(cameraPosition[2]).toBeGreaterThan(0);
});

test("updates visual architecture without resetting the camera", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const defaultCamera = await viewer.getAttribute("data-camera-position");
  await dragCanvas(page, viewer.locator("canvas"), 85, -20);
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(defaultCamera);

  await page.locator(".scene-details > summary").click();
  await page.locator('select[name="scene_furniture_preset"]').selectOption("dining");
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");
  await expect(viewer).toHaveAttribute("data-furniture-preset", "dining");
  await expect(viewer).toHaveAttribute("data-furniture-count", "5");
  await expect(viewer).not.toHaveAttribute("data-camera-position", defaultCamera);

  await page.locator('select[name="scene_door_enabled"]').selectOption("0");
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");
  await expect(viewer).toHaveAttribute("data-door-count", "0");
  await expect(viewer).toHaveAttribute("data-opening-count", "2");

  await page.locator("#room3d-toggle-roof").click();
  await expect(page.locator("#room3d-toggle-roof")).toHaveAttribute("aria-pressed", "true");
  await expect(viewer).toHaveAttribute("data-roof-visible", "true");
});

test("keeps context optional without changing the sunlight scene", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const patchCount = await viewer.getAttribute("data-patch-count");
  const contextButton = page.locator("#room3d-toggle-context");

  await contextButton.click();
  await expect(contextButton).toHaveAttribute("aria-pressed", "false");
  await expect(viewer).toHaveAttribute("data-context-visible", "false");
  await expect(viewer).toHaveAttribute("data-furniture-visible", "false");
  await expect(viewer).toHaveAttribute("data-patch-count", patchCount);

  await contextButton.click();
  await expect(viewer).toHaveAttribute("data-context-visible", "true");
  await expect(viewer).toHaveAttribute("data-furniture-visible", "true");
});

test("adds an exterior blocker through the full sunlight refresh path", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const requests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) requests.push(path);
  });

  await page.locator(".scene-details > summary").click();
  await page.locator('select[name="scene_external_obstruction"]').selectOption("building");
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");

  await expect(viewer).toHaveAttribute("data-external-obstruction-count", "1");
  await expect(viewer).toHaveAttribute("data-external-obstruction-preset", "building");
  await expect(viewer).toHaveAttribute("data-sunlight-blocker-count", "6");
  expect(requests.filter((path) => path === "/api/snapshot")).toHaveLength(1);
  expect(requests.filter((path) => path === "/api/scene-details")).toHaveLength(0);
});

test("uses the lightweight scene endpoint while the year estimate is active", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) requests.push(path);
  });

  await page.locator('[data-result-tab="long-range"]').click();
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");
  expect(requests.filter((path) => path === "/api/long-range-exposure")).toHaveLength(1);

  await page.locator(".scene-details > summary").click();
  await page.locator('select[name="scene_furniture_preset"]').selectOption("dining");
  await expect(page.locator("#update-status")).toHaveAttribute("data-state", "idle");

  expect(requests.filter((path) => path === "/api/scene-details")).toHaveLength(1);
  expect(requests.filter((path) => path === "/api/snapshot")).toHaveLength(0);
  expect(requests.filter((path) => path === "/api/long-range-exposure")).toHaveLength(1);

  await page.locator('[data-period-view="winter"]').click();
  await expect(page.locator('[data-period-view="winter"]')).toHaveClass(/is-active/);
  expect(requests.filter((path) => path === "/api/long-range-exposure")).toHaveLength(1);

  const viewer = await open3dRoom(page);
  await expect(viewer).toHaveAttribute("data-furniture-preset", "dining");
  await expect(viewer).toHaveAttribute("data-furniture-count", "5");
});

test("selects and highlights a named window from the 3D view", async ({ page }) => {
  const viewer = await open3dRoom(page);
  await expect(page.locator("#room3d-play")).toBeEnabled();
  const animationRequestsBeforeSelection = await page.evaluate(() => performance.getEntries()
    .filter((entry) => entry.name.includes("/api/day-animation?")).length);
  const sideWindowLabel = page.locator('.room3d-window-label[data-window-name="side_window"]');
  await expect(sideWindowLabel).toBeVisible();
  await expect(sideWindowLabel).toHaveText("Window 2");
  await sideWindowLabel.click();

  await expect(viewer).toHaveAttribute("data-selected-window", "side_window");
  await expect(sideWindowLabel).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#window-editor-title")).toHaveText("Window 2");
  await expect(page.locator("#selected-window-wall")).toHaveValue("east");
  const animationRequestsAfterSelection = await page.evaluate(() => performance.getEntries()
    .filter((entry) => entry.name.includes("/api/day-animation?")).length);
  expect(animationRequestsAfterSelection).toBe(animationRequestsBeforeSelection);
});

test("loads cached day frames and applies presets without rebuilding the room", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const playButton = page.locator("#room3d-play");
  await expect(playButton).toBeEnabled();
  await expect(viewer).toHaveAttribute("data-animation-frame-count", "144");
  const sceneBuildCount = await viewer.getAttribute("data-scene-build-count");
  const sunlightUpdateCount = await viewer.getAttribute("data-sunlight-update-count");

  await page.locator('[data-room3d-time-preset="noon"]').click();

  await expect(page.locator("#room3d-time-readout")).not.toHaveText("--:--");
  await expect(page.locator("#room3d-time-slider")).toHaveAttribute(
    "aria-valuetext",
    await page.locator("#room3d-time-readout").textContent(),
  );
  await expect(page.locator("#selected-time-input")).toHaveValue(
    await page.locator("#room3d-time-readout").textContent(),
  );
  await expect(viewer).toHaveAttribute("data-scene-build-count", sceneBuildCount);
  await expect.poll(() => viewer.getAttribute("data-sunlight-update-count")).not.toBe(sunlightUpdateCount);

  await page.locator("#room3d-time-slider").fill("0");
  await expect(page.locator("#sun-summary-moment")).toHaveText(
    "At the selected time, the sun does not enter this window.",
  );
  await page.locator('.room3d-window-label[data-window-name="side_window"]').click();
  await expect(page.locator("#sun-summary-moment")).toHaveText(
    "At the selected time, the sun does not enter this window.",
  );
});

test("plays and pauses daylight while keeping the selected time synchronized", async ({ page }) => {
  const viewer = await open3dRoom(page);
  await expect(page.locator("#room3d-play")).toBeEnabled();
  await page.locator('[data-room3d-time-preset="morning"]').click();
  const initialIndex = await viewer.getAttribute("data-animation-index");

  await page.locator("#room3d-play").click();
  await expect(viewer).toHaveAttribute("data-animation-playing", "true");
  await expect.poll(() => viewer.getAttribute("data-animation-index")).not.toBe(initialIndex);
  await page.locator("#room3d-play").click();

  await expect(viewer).toHaveAttribute("data-animation-playing", "false");
  await expect(page.locator("#selected-time-input")).toHaveValue(
    await page.locator("#room3d-time-readout").textContent(),
  );
});

test("does not flood the live status during day playback", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const status = page.locator("#room3d-status");
  await page.evaluate(() => {
    window.__room3dStatusChanges = [];
    const element = document.querySelector("#room3d-status");
    new MutationObserver(() => window.__room3dStatusChanges.push(element.textContent.trim()))
      .observe(element, { childList: true, characterData: true, subtree: true });
  });

  await page.locator("#room3d-play").click();
  await expect(viewer).toHaveAttribute("data-animation-playing", "true");
  await page.waitForTimeout(700);
  await page.locator("#room3d-play").click();
  await expect(viewer).toHaveAttribute("data-animation-playing", "false");

  const changes = await page.evaluate(() => window.__room3dStatusChanges);
  expect(changes).toHaveLength(2);
  expect(changes[0]).toContain("Playing the day");
  expect(changes[1]).toContain("paused");
  await expect(status).toContainText("paused");
});

test("orbits, resets, and toggles walls", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const canvas = viewer.locator("canvas");
  const initialCamera = await viewer.getAttribute("data-camera-position");
  await expect(viewer).toHaveAttribute("data-camera-preset", "perspective");
  await expect(page.locator('[data-room3d-camera-preset="perspective"]')).toHaveAttribute("aria-pressed", "true");

  await dragCanvas(page, canvas, 130, -45);
  await expect.poll(() => viewer.getAttribute("data-camera-position")).not.toBe(initialCamera);
  await expect(viewer).toHaveAttribute("data-camera-preset", "custom");

  await page.locator("#room3d-reset-camera").click();
  await expect.poll(() => viewer.getAttribute("data-camera-position")).toBe(initialCamera);
  await expect(viewer).toHaveAttribute("data-camera-preset", "perspective");

  await page.locator("#room3d-toggle-walls").click();
  await expect(page.locator("#room3d-toggle-walls")).toHaveAttribute("aria-pressed", "false");
  await expect(viewer).toHaveAttribute("data-walls-visible", "false");
  await expect(viewer.locator("canvas")).toBeVisible();
});

test("offers top and front camera presets aligned with the 2D plan", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const topButton = page.locator('[data-room3d-camera-preset="top"]');
  const frontButton = page.locator('[data-room3d-camera-preset="front"]');

  await topButton.click();
  await expect(viewer).toHaveAttribute("data-camera-preset", "top");
  await expect(topButton).toHaveAttribute("aria-pressed", "true");
  const topPosition = (await viewer.getAttribute("data-camera-position")).split(",").map(Number);
  const topTarget = (await viewer.getAttribute("data-camera-target")).split(",").map(Number);
  expect(topPosition[0]).toBeCloseTo(0, 3);
  expect(topPosition[1]).toBeGreaterThan(topTarget[1]);
  expect(topPosition[2]).toBeGreaterThan(topTarget[2]);
  expect(Math.abs(topPosition[2] - topTarget[2])).toBeLessThan((topPosition[1] - topTarget[1]) * 0.002);
  await expect(viewer).toHaveAttribute("data-axis-convention", "east-positive-x north-negative-z");

  await frontButton.click();
  await expect(viewer).toHaveAttribute("data-camera-preset", "front");
  await expect(frontButton).toHaveAttribute("aria-pressed", "true");
  const frontPosition = (await viewer.getAttribute("data-camera-position")).split(",").map(Number);
  const frontTarget = (await viewer.getAttribute("data-camera-target")).split(",").map(Number);
  expect(frontPosition[0]).toBeCloseTo(0, 3);
  expect(frontPosition[1]).toBeCloseTo(frontTarget[1], 3);
  expect(frontPosition[2]).toBeLessThan(frontTarget[2]);
  await expect(viewer).toHaveAttribute("data-camera-up", "0.000,1.000,0.000");
  await expect.poll(async () => (await viewer.getAttribute("data-visible-walls")).split(","))
    .toContain("north");
  await expect.poll(async () => (await viewer.getAttribute("data-auto-hidden-walls")).split(","))
    .not.toContain("north");
  await expect(page.locator('.room3d-window-label[data-window-name="main_window"]')).toBeVisible();
  await expect(page.locator('.room3d-window-label[data-window-name="side_window"]')).toBeHidden();

  const canvas = viewer.locator("canvas");
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect(viewer).toHaveAttribute("data-camera-preset", "custom");
  await expect.poll(async () => (await viewer.getAttribute("data-auto-hidden-walls")).split(","))
    .toContain("north");
});

test("automatically hides camera-facing walls and updates after orbit", async ({ page }) => {
  const viewer = await open3dRoom(page);
  const initialHiddenWalls = await viewer.getAttribute("data-auto-hidden-walls");
  expect(initialHiddenWalls).not.toBe("");

  const canvas = viewer.locator("canvas");
  await canvas.focus();
  for (let index = 0; index < 14; index += 1) {
    await canvas.press("ArrowRight");
  }
  await expect.poll(() => viewer.getAttribute("data-auto-hidden-walls")).not.toBe(initialHiddenWalls);
});

test("pauses rendering while the active viewer is offscreen", async ({ page }) => {
  const viewer = await open3dRoom(page);
  await page.setViewportSize({ width: 1440, height: 300 });
  await viewer.scrollIntoViewIfNeeded();
  await expect(viewer).toHaveAttribute("data-rendering", "true");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(viewer).toHaveAttribute("data-rendering", "false");

  await viewer.scrollIntoViewIfNeeded();
  await expect(viewer).toHaveAttribute("data-rendering", "true");
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
  await expect(page.locator("#room3d-play")).toBeEnabled();
  await page.locator("#room3d-play").click();
  await expect(viewer).toHaveAttribute("data-animation-playing", "true");
  await viewer.locator("canvas").dispatchEvent("webglcontextlost");

  await expect(viewer).toHaveAttribute("data-viewer-state", "fallback");
  await expect(viewer).toHaveAttribute("data-viewer-destroyed", "true");
  await expect(viewer).toHaveAttribute("data-rendering", "false");
  await expect(viewer).toHaveAttribute("data-animation-playing", "false");
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

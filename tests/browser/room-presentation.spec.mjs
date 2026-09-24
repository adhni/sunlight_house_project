import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  const viewer = page.locator('#room3d-container');
  await expect(viewer).toHaveAttribute('data-viewer-state', 'ready');
  await expect(page.locator('#room3d-play')).toBeEnabled();
  return viewer;
}

test('clean and analytical views share the same room, time, and camera', async ({ page }) => {
  const viewer = await ready(page);
  await expect(page.getByRole('button', { name: 'Room view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.room3d-window-label:visible')).toHaveCount(0);
  await expect(page.locator('.room3d-scene-legend')).toBeHidden();
  await expect(viewer).toHaveAttribute('data-goal-probe-visible', 'false');
  const builds = await viewer.getAttribute('data-scene-build-count');
  const windows = await viewer.getAttribute('data-window-geometry');
  const camera = await viewer.getAttribute('data-camera-position');
  const requests = [];
  page.on('request', request => { if (request.url().includes('/api/snapshot?')) requests.push(request.url()); });

  await page.getByRole('button', { name: 'Sunlight analysis', exact: true }).click();
  await expect(page.locator('.room3d-window-label:visible')).toHaveCount(2);
  await expect(page.locator('.room3d-scene-legend')).toBeVisible();
  await expect(viewer).toHaveAttribute('data-goal-probe-visible', 'true');
  await expect(viewer).toHaveAttribute('data-camera-position', camera);
  await page.locator('#room3d-time-slider').fill('72');
  await expect(page.locator('#selected-time-input')).toHaveValue('12:00');
  await page.getByRole('button', { name: 'Room view', exact: true }).click();
  await expect(page.locator('.room3d-window-label:visible')).toHaveCount(0);
  await expect(viewer).toHaveAttribute('data-window-geometry', windows);
  await expect(viewer).toHaveAttribute('data-scene-build-count', builds);
  await expect(page.locator('#selected-time-input')).toHaveValue('12:00');
  await expect(page.locator('#design-undo-button')).toBeDisabled();
  expect(requests).toHaveLength(0);
});

test('floor grid is independent of furniture and remembered for each presentation', async ({ page }) => {
  const viewer = await ready(page);
  await page.locator('.room3d-display-options > summary').click();
  await page.locator('#room3d-toggle-grid').click();
  await expect(viewer).toHaveAttribute('data-floor-grid-visible', 'true');
  await page.locator('#room3d-toggle-context').click();
  await expect(viewer).toHaveAttribute('data-furniture-visible', 'false');
  await expect(viewer).toHaveAttribute('data-floor-grid-visible', 'true');
  await page.locator('#room3d-toggle-grid').click();
  await page.locator('#room3d-toggle-context').click();
  await expect(viewer).toHaveAttribute('data-furniture-visible', 'true');
  await expect(viewer).toHaveAttribute('data-floor-grid-visible', 'false');
  await page.locator('.room3d-display-options > summary').click();
  await page.getByRole('button', { name: 'Sunlight analysis', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-floor-grid-visible', 'true');
  await page.getByRole('button', { name: 'Room view', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-floor-grid-visible', 'false');
});

test('laptop keeps the timeline in view and can collapse and restore the editor', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const viewer = await ready(page);
  expect((await viewer.boundingBox()).height).toBeGreaterThanOrEqual(400);
  const timeline = await page.locator('#room3d-animation-controls').boundingBox();
  expect(timeline.y + timeline.height).toBeLessThanOrEqual(768);
  const camera = await viewer.getAttribute('data-camera-position');
  await page.getByRole('button', { name: 'Sunlight analysis', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-camera-position', camera);
  const analysisTimeline = await page.locator('#room3d-animation-controls').boundingBox();
  expect(analysisTimeline.y + analysisTimeline.height).toBeLessThanOrEqual(768);
  const before = await viewer.boundingBox();
  await page.locator('#edit-room-button').click();
  await expect(page.locator('#inspector-slot')).toBeHidden();
  expect((await viewer.boundingBox()).width).toBeGreaterThan(before.width + 250);
  await page.locator('#room3d-explore').click();
  await page.locator('#explore-exit').click();
  await expect(page.locator('#inspector-slot')).toBeHidden();
  await page.locator('#edit-room-button').click();
  await expect(page.locator('#inspector-slot')).toBeVisible();
  await page.locator('#inspector-slot .inspector-close').click();
  await expect(page.locator('#edit-room-button')).toBeFocused();
});

test('mobile fullscreen enables gestures immediately and restores scroll-safe viewing', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const viewer = await ready(page);
    await expect(viewer).toHaveAttribute('data-touch-interaction', 'scroll');
    await page.locator('#room3d-explore').click();
    await expect(viewer).toHaveAttribute('data-touch-interaction', 'active');
    await expect(viewer.locator('.room3d-touch-toggle')).toBeHidden();
    await page.getByRole('button', { name: 'Sunlight analysis', exact: true }).click();
    await page.locator('#explore-exit').click();
    await expect(viewer).toHaveAttribute('data-touch-interaction', 'scroll');
    await expect(viewer.locator('canvas')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    await expect(page.getByRole('button', { name: 'Sunlight analysis', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally { await context.close(); }
});

test('day playback starts before dawn, resumes, and stops after dusk with replay', async ({ page }) => {
  const response = page.waitForResponse(response => response.url().includes('/api/day-animation?'));
  const viewer = await ready(page);
  const payload = await (await response).json();
  const play = page.locator('#room3d-play');
  const slider = page.locator('#room3d-time-slider');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await play.click();
  await expect(slider).toHaveValue(String(payload.playback_start_index));
  await expect(viewer).toHaveAttribute('data-sun-intensity', '0.0000');
  await page.clock.runFor(120 * 10);
  await play.click();
  await expect(play).toHaveText('Resume');
  const paused = await slider.inputValue();
  await page.clock.runFor(120 * 10);
  await expect(slider).toHaveValue(paused);
  await play.click();
  await expect(slider).toHaveValue(paused);
  await page.clock.runFor(120 * 144);
  await expect(play).toHaveText('Replay');
  await expect(slider).toHaveValue(String(payload.playback_end_index));
  await expect(viewer).toHaveAttribute('data-sun-intensity', '0.0000');
  await page.clock.runFor(120 * 10);
  await expect(slider).toHaveValue(String(payload.playback_end_index));
  await play.click();
  await expect(slider).toHaveValue(String(payload.playback_start_index));
  await slider.fill('72');
  await expect(play).toHaveText('Play day');
  await play.click();
  await expect(slider).toHaveValue(String(payload.playback_start_index));
});

test('arranging started in fullscreen remains touch-enabled after exit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const viewer = await ready(page);
    await page.locator('#room3d-explore').click();
    await page.locator('#explore-edit').click();
    await page.locator('.inspector-tabs [data-inspector="furniture"]').click();
    await page.locator('#furniture-arrange-button').click();
    await page.locator('#explore-exit').click();
    await expect(viewer).toHaveAttribute('data-arrange-mode', 'true');
    await expect(viewer).toHaveAttribute('data-touch-interaction', 'active');
    await expect(viewer.locator('canvas')).toHaveCSS('touch-action', 'none');
    await page.locator('#edit-room-button').click();
    await page.locator('#furniture-arrange-button').click();
    await expect(viewer).toHaveAttribute('data-touch-interaction', 'scroll');
  } finally { await context.close(); }
});

for (const exitBeforeReady of [false, true]) {
  test(`slow-loading mobile viewer respects fullscreen state (exit early: ${exitBeforeReady})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/room3d.bundle.js', async route => { await gate; await route.continue(); });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('#room3d-explore').click();
      if (exitBeforeReady) await page.locator('#explore-exit').click();
      release();
      const viewer = page.locator('#room3d-container');
      await expect(viewer).toHaveAttribute('data-viewer-state', 'ready');
      await expect(viewer).toHaveAttribute('data-touch-interaction', exitBeforeReady ? 'scroll' : 'active');
      if (!exitBeforeReady) {
        await expect(viewer.locator('.room3d-touch-toggle')).toBeHidden();
        await page.locator('#explore-exit').click();
        await expect(viewer).toHaveAttribute('data-touch-interaction', 'scroll');
      }
    } finally { release(); await context.close(); }
  });
}

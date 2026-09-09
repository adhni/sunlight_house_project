import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#room3d-container')).toHaveAttribute('data-viewer-state', 'ready');
  await expect(page.locator('#room3d-play')).toBeEnabled();
}
async function committed(page, action) {
  const response = page.waitForResponse(r => r.url().includes('/api/snapshot?') && r.ok());
  await action();
  await response;
  await expect(page.locator('#update-status')).toHaveAttribute('data-state', 'idle');
}

test('three destinations expose only their own views and support keyboard navigation', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#mode-room')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-result-tab]:visible')).toHaveText(['3D', '2D plan']);
  await page.locator('#mode-room').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#mode-exposure')).toBeFocused();
  await expect(page.locator('[data-result-tab]:visible')).toHaveText(['Today', 'Seasons & year']);
  await page.keyboard.press('Home');
  await expect(page.locator('#result-panel-room-3d')).toBeVisible();
});

test('exact typed times stay exact and time exploration does not create undo entries', async ({ page }) => {
  await ready(page);
  await committed(page, () => page.locator('#selected-time-input').fill('10:07'));
  await expect(page.locator('#room3d-time-slider')).toHaveAttribute('aria-valuetext', '10:07');
  await expect(page.locator('#room3d-reading-state')).toContainText('10:07');
  await expect(page.locator('#design-undo-button')).toBeDisabled();
  await page.locator('#room3d-time-slider').fill('72');
  await expect(page.locator('#selected-time-input')).toHaveValue('12:00');
  await expect(page.locator('#design-undo-button')).toBeDisabled();
});

test('undo restores design geometry while retaining the selected time', async ({ page }) => {
  await ready(page);
  const width = page.locator('[name=window_width]');
  await committed(page, async () => { await width.fill('1.2'); await width.blur(); });
  await committed(page, () => page.locator('#selected-time-input').fill('11:07'));
  await committed(page, () => page.locator('#design-undo-button').click());
  await expect(width).toHaveValue('1.5');
  await expect(page.locator('#selected-time-input')).toHaveValue('11:07');
  await expect(page.locator('#design-undo-button')).toBeDisabled();
  const windows = JSON.parse(await page.locator('#room3d-container').getAttribute('data-window-geometry'));
  expect(windows[0].width).toBe(1.5);
});

test('invalid geometry keeps the last valid preview and describes how to fix the field', async ({ page }) => {
  await ready(page);
  const viewer = page.locator('#room3d-container');
  const before = await viewer.getAttribute('data-window-geometry');
  await page.locator('[name=window_width]').fill('12');
  await expect(page.locator('[name=window_width]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#window_width-error')).toContainText('4 m or less');
  await expect(viewer).toHaveAttribute('data-window-geometry', before);
  await committed(page, async () => { await page.locator('[name=window_width]').fill('1.3'); await page.locator('[name=window_width]').blur(); });
  await expect(page.locator('[name=window_width]')).toHaveAttribute('aria-invalid', 'false');
});

test('a failed preview offers retry and retains the last model', async ({ page }) => {
  await ready(page);
  await page.route('**/api/snapshot?**', route => route.fulfill({status: 503, contentType:'application/json', body: JSON.stringify({error:'Preview temporarily unavailable.'})}));
  const viewer = page.locator('#room3d-container');
  const before = await viewer.getAttribute('data-window-geometry');
  await page.locator('[name=window_width]').fill('1.2');
  await page.locator('[name=window_width]').blur();
  await expect(page.locator('#retry-update')).toBeVisible();
  await expect(viewer).toHaveAttribute('data-window-geometry', before);
  await page.unroute('**/api/snapshot?**');
  await committed(page, () => page.locator('#retry-update').click());
  await expect(viewer).not.toHaveAttribute('data-window-geometry', before);
  await expect(page.locator('#retry-update')).toBeHidden();
});

test('location and comparison dialogs pause playback and restore focus', async ({ page }) => {
  await ready(page);
  await page.locator('#room3d-play').click();
  await page.locator('#location-button').click();
  await expect(page.locator('#location-dialog')).toBeVisible();
  await expect(page.locator('#room3d-play')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#location-dialog')).toContainText('2025 historical data');
  await page.locator('[data-location-preset=jakarta]').click();
  await expect(page.locator('#workspace-location')).toContainText('Jakarta');
  await page.keyboard.press('Escape');
  await expect(page.locator('#location-button')).toBeFocused();
  await page.locator('[data-open-dialog=compare-dialog]').click();
  await page.locator('#save-baseline-button').click();
  await expect(page.locator('#baseline-details')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-open-dialog=compare-dialog]')).toBeFocused();
});

test('mobile uses one editor, contains focus, and reflows at 320px', async ({ page }) => {
  await page.setViewportSize({width:320,height:760});
  await ready(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('#edit-room-button').click();
  await expect(page.locator('#inspector-dialog')).toBeVisible();
  await expect(page.locator('#inspector')).toHaveCount(1);
  await page.locator('.inspector-tabs [data-inspector=room]').click();
  await expect(page.locator('[name=room_width]')).toBeVisible();
  for (let index=0;index<20;index++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('dialog')?.id)).toBe('inspector-dialog');
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit-room-button')).toBeFocused();
  await page.setViewportSize({width:1366,height:768});
  await expect(page.locator('#inspector-slot #inspector')).toBeVisible();
  await expect(page.locator('#inspector')).toHaveCount(1);
});

test('falls back to an interactive 2D plan when the 3D bundle fails', async ({ page }) => {
  await page.route('**/room3d.bundle.js', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#result-panel-current')).toBeVisible();
  await expect(page.locator('#room-window-source')).toBeVisible();
  await expect(page.locator('#room3d-play')).toBeEnabled();
  await page.locator('#room3d-time-slider').fill('0');
  await expect(page.locator('#selected-time-input')).toHaveValue('00:00');
  await expect(page.locator('#room3d-reading-state')).toContainText('00:00');
});

test('undo restores a furniture preset after time changes without adding a phantom edit', async ({ page }) => {
  await ready(page);
  await page.locator('.inspector-tabs [data-inspector=furniture]').click();
  await page.locator('#scene-furniture-preset').selectOption('dining');
  await expect(page.locator('#room3d-container')).toHaveAttribute('data-furniture-count', '5');
  await committed(page, () => page.locator('#selected-time-input').fill('11:07'));
  await committed(page, () => page.locator('#design-undo-button').click());
  await expect(page.locator('#room3d-container')).toHaveAttribute('data-furniture-preset', 'living');
  await expect(page.locator('#room3d-container')).toHaveAttribute('data-furniture-count', '2');
  await expect(page.locator('#design-undo-button')).toBeDisabled();
});

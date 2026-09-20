import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  const viewer = page.locator('#room3d-container');
  await expect(viewer).toHaveAttribute('data-viewer-state', 'ready');
  await expect(page.locator('#room3d-play')).toBeEnabled();
  return viewer;
}

test('Explore expands the live canvas, plays sunlight, and restores camera and focus', async ({ page }) => {
  const viewer = await ready(page);
  const originalSize = await viewer.boundingBox();
  const builds = await viewer.getAttribute('data-scene-build-count');
  await viewer.locator('canvas').evaluate(canvas => { window.originalRoomCanvas = canvas; });
  await page.locator('#room3d-explore').click();
  const dialog = page.locator('#room3d-explore-dialog');
  await expect(dialog).toBeVisible();
  const size = await dialog.boundingBox();
  expect(size.width).toBe(page.viewportSize().width);
  expect(size.height).toBe(page.viewportSize().height);
  expect((await viewer.boundingBox()).height).toBeGreaterThan(originalSize.height);
  await expect(page.locator('#explore-editor')).toBeHidden();
  expect(await viewer.locator('canvas').evaluate(canvas => canvas === window.originalRoomCanvas)).toBe(true);
  await page.locator('#room3d-time-slider').fill('72');
  await expect(page.locator('#selected-time-input')).toHaveValue('12:00');
  await page.locator('#room3d-play').click();
  await expect(page.locator('#room3d-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#selected-time-input')).not.toHaveValue('12:00');
  await page.locator('#room3d-play').click();
  await viewer.locator('canvas').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toHaveAttribute('data-camera-preset', 'custom');
  const camera = await viewer.getAttribute('data-camera-position');
  const time = await page.locator('#selected-time-input').inputValue();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#room3d-explore')).toBeFocused();
  await expect(viewer).toHaveAttribute('data-camera-position', camera);
  await expect(viewer).toHaveAttribute('data-scene-build-count', builds);
  await expect(page.locator('#selected-time-input')).toHaveValue(time);
  await expect(page.locator('#inspector-slot #inspector')).toBeVisible();
  await page.locator('#room3d-explore').click();
  await page.locator('#explore-exit').click();
  await expect(page.locator('#room3d-explore')).toBeFocused();
  await expect(page.locator('#room3d-animation-controls')).toHaveCount(1);
  await expect(page.locator('#inspector')).toHaveCount(1);
});

test('window, furniture, date, and undo controls edit the same design in Explore', async ({ page }) => {
  const viewer = await ready(page);
  await page.locator('#room3d-explore').click();
  await page.locator('.room3d-window-label[data-window-name="main_window"]').click();
  await expect(page.locator('#explore-editor')).toBeVisible();
  await expect(page.locator('#explore-edit')).toHaveAttribute('aria-expanded', 'true');
  const width = page.locator('[name=window_width]');
  await width.fill('1.2');
  await width.blur();
  await expect.poll(async () => JSON.parse(await viewer.getAttribute('data-window-geometry'))[0].width).toBe(1.2);
  expect(await width.evaluate(input => input.form.id)).toBe('simulation-form');
  await page.locator('#selected-date-input').fill('2025-06-21');
  await expect(page.locator('#update-status')).toHaveAttribute('data-state', 'idle');
  await page.locator('#design-undo-button').click();
  await expect(width).toHaveValue('1.5');
  await expect(page.locator('#selected-date-input')).toHaveValue('2025-06-21');
  await page.locator('.inspector-tabs [data-inspector=furniture]').click();
  await page.locator('#scene-furniture-preset').selectOption('dining');
  await expect(viewer).toHaveAttribute('data-furniture-count', '5');
  await page.locator('#explore-editor .inspector-close').click();
  await expect(page.locator('#explore-editor')).toBeHidden();
  await expect(page.locator('#explore-edit')).toBeFocused();
  await page.locator('#explore-edit').click();
  await expect(page.locator('#scene-furniture-preset')).toHaveValue('dining');
  await page.locator('#explore-exit').click();
  await expect(page.locator('#inspector-slot #scene-furniture-preset')).toHaveValue('dining');
  await expect(viewer).toHaveAttribute('data-furniture-count', '5');
});

test('Explore retains camera and display controls and closes safely on WebGL failure', async ({ page }) => {
  const viewer = await ready(page);
  await page.locator('#room3d-explore').click();
  await page.locator('[data-room3d-camera-preset=top]').click();
  await expect(viewer).toHaveAttribute('data-camera-preset', 'top');
  await page.locator('.room3d-display-options > summary').click();
  await page.locator('#room3d-toggle-walls').click();
  await expect(viewer).toHaveAttribute('data-walls-visible', 'false');
  await page.locator('#room3d-toggle-beams').click();
  await expect(viewer).toHaveAttribute('data-beams-visible', 'true');
  await page.locator('#room3d-reset-camera').click();
  await expect(viewer).toHaveAttribute('data-camera-preset', 'perspective');
  await viewer.locator('canvas').dispatchEvent('webglcontextlost', { cancelable: true });
  await expect(page.locator('#room3d-explore-dialog')).not.toBeVisible();
  await expect(page.locator('#result-panel-current')).toBeVisible();
  await expect(page.locator('#selected-time-input')).toBeVisible();
  await expect(page.locator('#inspector-slot #inspector')).toBeVisible();
});

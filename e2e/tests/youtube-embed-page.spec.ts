import { expect, test } from '@playwright/test';

// /embed/youtube.html: the static page the App Store app frames so YouTube sees a real https
// embedder (frontend/public/embed/youtube.html explains error 153). Account-free, no app shell.
// The page's own route headers (CSP frame-ancestors / frame-src) only exist on a deployed Static
// Web App and are pinned by frontend/src/embedPage.test.js; this spec covers what the page does.
test.describe('YouTube embed page', () => {
  test('frames the requested video from youtube-nocookie.com, and is not the app shell', async ({ page }) => {
    await page.goto('/embed/youtube.html?v=j7ULT6dznNc');

    const frame = page.locator('iframe[title="Exercise demo video"]');
    await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/j7ULT6dznNc?playsinline=1&rel=0');
    await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    // The app shell would mount into #root; this page has none.
    await expect(page.locator('#root')).toHaveCount(0);
  });

  test('refuses anything that is not a YouTube video id', async ({ page }) => {
    await page.goto('/embed/youtube.html?v=%3Cimg%20src%3Dx%3E');

    await expect(page.getByText('This video link is not valid.', { exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});

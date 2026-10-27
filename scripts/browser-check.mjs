import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { example } from '../shared/example.js';

await mkdir('.local', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  colorScheme: 'light',
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const response = await page.goto('http://127.0.0.1:5173/');
  assert.equal(response.status(), 200);
  await page.getByRole('heading', { name: /Your answer,/ }).waitFor();
  assert.equal(await page.title(), 'Hallucination Visualizer');
  await page.screenshot({ path: '.local/desktop.png', fullPage: true });

  // The demo is bundled locally and works even when every API call fails.
  await page.route('**/api/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Try an example' }).click();
  assert.equal(await page.locator('.claim-list > li').count(), 5);
  assert.equal(
    await page.locator('.original-answer mark.selected').textContent(),
    'The first crewed Moon landing took place in July 1969.',
  );
  await page.locator('.claim-button').nth(2).click();
  assert.equal(
    await page.locator('.original-answer mark.selected').textContent(),
    'All three astronauts walked on the lunar surface.',
  );
  assert.equal(await page.locator('.trust-map:not(.mini) button').count(), 5);
  await page.getByRole('button', { name: 'Go to statement 4, Low trust' }).click();
  assert.equal(
    await page.locator('.original-answer mark.selected').textContent(),
    'The crew stayed on the Moon for an entire week.',
  );
  await page.getByRole('tab', { name: 'Agreement view' }).click();
  assert.equal(await page.locator('.agreement-list > button').count(), 5);
  await page.getByRole('tab', { name: 'Highlight view' }).click();
  await page.screenshot({ path: '.local/example.png', fullPage: true });

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.reload();
  await page.getByRole('button', { name: 'Switch to light mode' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.screenshot({ path: '.local/dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();

  await page.getByRole('button', { name: 'How it works' }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);

  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('button', { name: 'Clear answer and results' }).click();
  assert.equal(await page.locator('#answer').inputValue(), '');
  assert.equal(await page.locator('.claim-list > li').count(), 0);
  assert.ok(await page.getByRole('button', { name: 'Check answer', exact: true }).isDisabled());

  await page.locator('#answer').fill('The Moon orbits Earth.');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /Could not reach the app server/);
  await page.unroute('**/api/**');

  // Exercise the complete UI request path deterministically without API charges.
  await page.route('**/api/checks', (route) =>
    route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        check: {
          id: 'browser-test',
          status: 'complete',
          mode: 'live',
          answerText: 'The Moon orbits Earth.',
          claims: [
            {
              id: 'moon',
              claimText: 'The Moon orbits Earth.',
              startIndex: 0,
              endIndex: 22,
              trustLevel: null,
            },
          ],
        },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByText('Statements found', { exact: true }).waitFor();
  assert.equal(await page.locator('.claim-list > li').count(), 1);
  await page.unroute('**/api/checks');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Try an example' }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
    if (width === 390) await page.screenshot({ path: '.local/mobile.png', fullPage: true });
  }
  const savedCheck = { ...example, id: 'saved-browser-check', mode: 'live', saved: true };
  await page.route('**/api/checks?page=*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ checks: [savedCheck], total: 1, page: 1, pageSize: 20 }),
    }),
  );
  await page.route('**/api/checks/saved-browser-check', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ check: savedCheck }) }),
  );
  await page.route('**/api/checks/saved-browser-check/share', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ path: `/#/shared/${'a'.repeat(48)}` }),
    }),
  );
  await page.route('**/api/shared/*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ check: { ...savedCheck, readOnly: true, documentText: undefined } }),
    }),
  );
  await page.route('**/api/stats', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        checks: 1,
        claims: 5,
        High: 3,
        Medium: 0,
        Low: 2,
        trend: [{ date: '2026-10-27', claims: 5, checks: 1, High: 3, Medium: 0, Low: 2 }],
      }),
    }),
  );
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.locator('.history-card').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.history-card').first().click();
  await page.getByRole('button', { name: 'Share result', exact: true }).waitFor();
  assert.equal(await page.locator('#answer').inputValue(), example.answerText);
  await page.getByRole('button', { name: 'Share result', exact: true }).click();
  await page.locator('.share-message').waitFor();
  await page.goto(`http://127.0.0.1:5173/#/shared/${'a'.repeat(48)}`);
  await page.getByRole('heading', { name: 'A shared answer, under the lens' }).waitFor();
  assert.equal(await page.locator('#answer').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Share result', exact: true }).count(), 0);
  await page.getByRole('link', { name: 'Stats', exact: true }).click();
  await page.getByRole('heading', { name: 'Statements over time' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.local/stats-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.local/stats.png', fullPage: true });
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.locator('.history-card').first().waitFor();
  await page.screenshot({ path: '.local/history.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: desktop, 390px/320px mobile, offline example, trust map, evidence, agreement view, theme persistence, guide, reset, errors, history, stats, and read-only sharing.',
  );
} finally {
  await browser.close();
}

import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { example } from '../shared/example.js';

await mkdir('.local', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let status = 'not_addressed';
  const generated = 'Armstrong and Aldrin landed on July 20, 1969.';
  const reasons = {
    not_addressed: 'This answer gives the date but does not say this was the first crewed landing.',
    generation_failed: 'Gemini usage limit reached.',
    comparison_failed: 'Gemini answer comparison could not finish.',
  };
  await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/checks', (route) => {
    const repeatResult = {
      matches: Array(5).fill(null),
      hits: 0,
      completed: 0,
      basis: 'document',
      ...(status === 'legacy'
        ? {}
        : {
            generated: status === 'generation_failed' ? 0 : 5,
            generationFailed: status === 'generation_failed' ? 5 : 0,
            comparisonFailed: status === 'comparison_failed' ? 5 : 0,
            unaddressed: status === 'not_addressed' ? 5 : 0,
            unavailable: 0,
            comparisons: Array.from({ length: 5 }, () => ({
              status,
              answer: status === 'generation_failed' ? null : generated,
              reason: reasons[status],
              ...(status === 'not_addressed' ? {} : { errorCode: 'GEMINI_RATE_LIMIT' }),
            })),
          }),
    };
    return route.fulfill({
      json: {
        check: {
          ...example,
          mode: 'live',
          claims: [
            {
              ...example.claims[0],
              repeatResult,
              warnings: [
                '5 Gemini answers were unavailable or did not address this statement well enough to compare. This does not change the evidence-based trust label.',
              ],
            },
          ],
        },
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Try an example', exact: true }).click();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.locator('.repeat-detail .agreement')).toContainText(
    '5 answers generated; none addressed this complete statement',
  );
  await expect(page.locator('.evidence-detail .trust-badge')).toContainText('High trust');
  await expect(page.getByText(/Gemini answers were unavailable or did not address/)).toHaveCount(0);
  await page.locator('.agreement-breakdown > summary').click();
  await expect(page.locator('.agreement-breakdown > ol > li')).toHaveCount(5);
  await expect(page.locator('.agreement-breakdown li').first()).toContainText(
    'does not say this was the first',
  );
  await page.getByText('Read generated answer 1', { exact: true }).click();
  await expect(page.locator('.agreement-breakdown blockquote').first()).toHaveText(generated);
  await page.screenshot({ path: '.local/agreement-diagnostics-desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (width === 390)
      await page.screenshot({ path: '.local/agreement-diagnostics-mobile.png', fullPage: true });
  }
  for (const mode of ['generation_failed', 'comparison_failed', 'legacy']) {
    status = mode;
    await page.getByRole('button', { name: 'Check answer', exact: true }).click();
    await expect(page.locator('.repeat-detail')).toContainText(
      mode === 'generation_failed'
        ? 'No Gemini answers could be generated'
        : mode === 'comparison_failed'
          ? '5 answers generated; answer comparison was unavailable'
          : 'earlier check has no detailed comparison reasons',
    );
    await expect(page.locator('.evidence-detail .trust-badge')).toContainText('High trust');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'Agreement UI passed: omitted qualifiers, generated answer text, specific failure categories, historical unknowns, unchanged trust, and mobile layouts.',
  );
} finally {
  await browser.close();
}

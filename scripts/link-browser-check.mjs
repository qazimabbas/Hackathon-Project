import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('.local', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = 'https://example.com/article';
const text = 'The Red Planet has a pair of natural satellites.';
const claim = {
  id: 'moon',
  claimText: text,
  verificationText: 'Mars has two natural satellites.',
  startIndex: 0,
  endIndex: text.length,
  status: 'complete',
  trustLevel: 'High',
  reasonText: 'A pair means two moons in this question.',
  sourceResult: {
    verdict: 'supported',
    assessmentType: 'direct',
    sourceKind: 'link',
    evidenceSnippet: 'Mars has two moons.',
    sourceTitle: 'Chosen article',
    sourceUrl: url,
  },
  repeatResult: { matches: [true, true, true, true, true], hits: 5, completed: 5, basis: 'source' },
};
const check = {
  id: 'link-browser',
  status: 'complete',
  mode: 'live',
  trustPolicy: 'evidence-only-v1',
  answerText: text,
  question: 'How many moons does Mars have?',
  documentText: '',
  sourceUrl: url,
  linkedSource: { title: 'Chosen article', url, text: 'Mars has two moons.' },
  claims: [claim],
  warnings: [],
};
let mode = 'success',
  submitted,
  finishStream;
const gate = new Promise((resolve) => {
  finishStream = resolve;
});
try {
  await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/checks', (route) => {
    submitted = route.request().postDataJSON();
    if (mode === 'unavailable')
      return route.fulfill({
        json: {
          id: 'unavailable',
          check: {
            ...check,
            id: 'unavailable',
            linkedSource: undefined,
            claims: [
              {
                ...claim,
                status: 'error',
                trustLevel: null,
                sourceResult: null,
                reasonText: 'The evidence model is temporarily unavailable.',
                verificationError: {
                  code: 'GEMINI_RATE_LIMIT',
                  message: 'The evidence model is temporarily unavailable.',
                },
              },
            ],
          },
        },
      });
    return route.fulfill({
      status: 202,
      json: {
        id: 'link-browser',
        check: {
          ...submitted,
          id: 'link-browser',
          status: 'loading_source',
          mode: 'live',
          claims: [],
          warnings: [],
        },
      },
    });
  });
  await page.route('**/api/checks/link-browser/stream', async (route) => {
    await gate;
    const snapshot =
      mode === 'failed'
        ? {
            ...check,
            claims: [],
            linkedSource: undefined,
            status: 'failed',
            error: {
              code: 'SOURCE_UNREADABLE',
              message: 'This page could not be read. Upload the document or paste its text.',
            },
          }
        : check;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    });
  });
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByRole('textbox', { name: 'Source link', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Choose document', exact: true })).toBeVisible();
  await page.locator('#answer').fill(text);
  await page.locator('#question').fill(check.question);
  await page.locator('#source').fill('My document draft.');
  await page.getByRole('radio', { name: 'Add a link', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Choose document', exact: true })).toBeHidden();
  await page.locator('#source-url').fill(url);
  await page.getByRole('radio', { name: 'Upload document', exact: true }).check();
  await expect(page.locator('#source')).toHaveValue('My document draft.');
  await expect(page.locator('#source-url')).toBeHidden();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reading linked source...' })).toBeVisible();
  assert.equal(submitted.documentText, 'My document draft.');
  assert.equal(submitted.sourceUrl, '');
  finishStream();
  await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Add a link', exact: true }).check();
  await expect(page.locator('#source-url')).toHaveValue(url);
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect.poll(() => submitted.sourceUrl).toBe(url);
  assert.equal(submitted.sourceUrl, url);
  assert.equal(submitted.documentText, check.documentText);
  await expect(page.getByRole('heading', { name: 'Backed by your linked source' })).toBeVisible();
  await expect(page.locator('.contextual-claim')).toContainText('Mars has two natural satellites.');
  await expect(page.locator('.repeat-detail')).toContainText('source-based');
  await expect(page.locator('.linked-source-notice a')).toHaveAttribute('href', url);
  await page.screenshot({ path: '.local/link-source-desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (width === 390)
      await page.screenshot({ path: '.local/link-source-mobile.png', fullPage: true });
  }
  mode = 'failed';
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('This page could not be read');
  await expect(page.locator('#source')).toHaveValue('My document draft.');
  await expect(page.locator('#source-url')).toHaveValue(url);
  mode = 'unavailable';
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Evidence verification unavailable' }),
  ).toBeVisible();
  await expect(page.locator('.donut')).toContainText('unrated');
  await expect(page.locator('.evidence-detail .trust-badge')).toHaveText('!Evidence unavailable');
  await expect(page.locator('.evidence-detail')).toContainText('GEMINI_RATE_LIMIT');
  await expect(page.locator('.repeat-detail')).toContainText('5 of 5');
  assert.equal(await page.locator('.trust-badge[data-level="High"]').count(), 0);
  await page.getByRole('button', { name: 'Clear answer and results' }).click();
  await expect(page.locator('#source-url')).toHaveValue('');
  await expect(page.locator('#source')).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'Upload document', exact: true })).toBeChecked();
  await expect(page.locator('#source-url')).toBeHidden();
  assert.deepEqual(errors, []);
  console.log(
    'Link browser checks passed: exclusive source choice, preserved drafts, selected-source payloads, loading/SSE, citations, paraphrases, mobile, errors, and reset.',
  );
} finally {
  await browser.close();
}

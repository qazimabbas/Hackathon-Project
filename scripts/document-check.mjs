import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const reference = 'Apollo 11 landed on the Moon on July 20, 1969.';

// Small, real document fixtures. Stored ZIP entries avoid a fixture-library dependency.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const entries = [],
    directory = [];
  let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = Buffer.from(filename),
      data = Buffer.from(content),
      crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    entries.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const listing = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, listing, end]);
}
function docx() {
  return zip({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${reference}</w:t></w:r></w:p></w:body></w:document>`,
  });
}
function pdf(text) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(data);
}

await mkdir('.local', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: { limits: { answer: 12000, question: 2000, document: 60000, claims: 10 } },
    }),
  );
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByRole('textbox', { name: 'Source document', exact: true })).toBeVisible();
  const input = page.locator('#source-file');
  for (const file of [
    { name: 'reference.txt', mimeType: 'text/plain', buffer: Buffer.from(reference) },
    { name: 'reference.md', mimeType: 'text/markdown', buffer: Buffer.from(reference) },
    { name: 'reference.pdf', mimeType: 'application/pdf', buffer: pdf(reference) },
    {
      name: 'reference.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docx(),
    },
  ]) {
    await input.setInputFiles(file);
    await expect(page.locator('.source-import-status')).toContainText(file.name, {
      timeout: 30000,
    });
    await expect(page.locator('#source')).toHaveValue(reference);
    await page.getByRole('button', { name: 'Clear source', exact: true }).click();
    await expect(page.locator('#source')).toHaveValue('');
  }
  await page.locator('#source').fill(reference);
  for (const [name, buffer, message] of [
    ['wrong.doc', Buffer.from('text'), /Choose a PDF/],
    ['broken.pdf', Buffer.from('not a PDF'), /could not be read/],
    ['empty.pdf', pdf(''), /No readable text/],
    ['broken.docx', Buffer.from('not a DOCX'), /could not be read/],
    ['empty.txt', Buffer.from(' '), /No readable text/],
    ['long.txt', Buffer.from('x'.repeat(60001)), /character limit/],
    ['large.txt', Buffer.alloc(10 * 1024 * 1024 + 1), /10 MB/],
  ]) {
    await input.setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
    await expect(page.locator('.source-import-error')).toHaveText(message);
    await expect(page.locator('#source')).toHaveValue(reference);
  }
  await input.setInputFiles({
    name: 'checked.docx',
    mimeType: 'application/octet-stream',
    buffer: docx(),
  });
  await expect(page.locator('.source-import-status')).toContainText('checked.docx');
  let submitted;
  await page.route('**/api/checks', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      json: {
        id: 'document-test',
        check: {
          id: 'document-test',
          status: 'complete',
          mode: 'live',
          answerText: submitted.answerText,
          documentText: submitted.documentText,
          claims: [],
          overallSummary: { total: 0, High: 0, Medium: 0, Low: 0, pending: 0, errors: 0 },
          warnings: [],
        },
      },
    });
  });
  await page.locator('#answer').fill('Apollo 11 landed in July 1969.');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toBeEnabled();
  await expect.poll(() => submitted?.documentText).toBe(reference);
  await page.getByRole('button', { name: 'Clear answer and results' }).click();
  await expect(page.locator('#source')).toHaveValue('');
  await expect(page.locator('.source-import-status')).toBeEmpty();
  await page.locator('#source').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/source-document-desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await expect(page.getByRole('button', { name: 'Choose document', exact: true })).toBeVisible();
    if (width === 390)
      await page.screenshot({ path: '.local/source-document-mobile.png', fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Document checks passed: TXT, MD, PDF, DOCX, invalid/empty/oversized files, preserved source text, request payload, reset, and mobile layouts.',
  );
} finally {
  await browser.close();
}

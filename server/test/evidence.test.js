import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentSources, judgeEvidence } from '../src/evidence.js';
import { mapConcurrent } from '../src/concurrency.js';

test('short documents are compared whole and long documents retrieve relevant local passages', () => {
  assert.equal(documentSources('Short source.', 'claim')[0].text, 'Short source.');
  const long =
    'Filler about flowers. '.repeat(1500) + 'The lunar mission returned on July 24, 1969.';
  const sources = documentSources(long, 'The lunar mission returned on July 24, 1969.');
  assert.equal(sources.length, 4);
  assert.ok(sources.some((source) => source.text.includes('July 24, 1969')));
  assert.ok(sources.every((source) => long.includes(source.text)));
});

test('verifies evidence quotes against the actual source rather than trusting generated citations', async () => {
  const sources = documentSources(
    'Two astronauts walked on the Moon.',
    'Three astronauts walked on the Moon.',
  );
  const good = await judgeEvidence('Three astronauts walked on the Moon.', sources, {
    generateJson: async () => ({
      verdict: 'contradicted',
      reason: 'Your document says two astronauts walked on the Moon.',
      sourceId: 'document',
      exactQuote: 'Two astronauts walked on the Moon.',
    }),
  });
  assert.equal(good.verdict, 'contradicted');
  const ungrounded = await judgeEvidence('Three astronauts walked on the Moon.', sources, {
    generateJson: async () => ({
      verdict: 'supported',
      reason: 'Supported.',
      sourceId: 'document',
      exactQuote: 'Three astronauts walked on the Moon.',
    }),
  });
  assert.equal(ungrounded.verdict, 'not_enough');
  assert.equal(ungrounded.evidenceSnippet, '');
});

test('no sources gives no proof and malformed source judgments are rejected', async () => {
  const none = await judgeEvidence('Claim', [], {
    generateJson: () => {
      throw new Error('Must not call');
    },
  });
  assert.equal(none.verdict, 'not_enough');
  await assert.rejects(
    judgeEvidence('Claim', [{ id: 'a', text: 'Source' }], {
      generateJson: async () => ({ score: 10 }),
    }),
    { code: 'INVALID_EVIDENCE' },
  );
});

test('parallel work respects its limit and preserves input order', async () => {
  let active = 0,
    peak = 0;
  const output = await mapConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return item * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(output, [2, 4, 6, 8, 10]);
});

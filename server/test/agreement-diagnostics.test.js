import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatCheck } from '../src/repeat.js';
import { AppError } from '../src/errors.js';
import { agreementLabel } from '../../client/src/agreement.js';

const claims = [
  { id: 'landing', claimText: 'The first crewed Moon landing took place in July 1969.' },
];
const answer = 'Armstrong and Aldrin landed on July 20, 1969.';
const comparison = (match = null) => ({
  claims: [
    {
      id: 'landing',
      matches: Array(5).fill(match),
      reasons: Array(5).fill(
        'The answer gives the date but does not establish that this was the first crewed landing.',
      ),
    },
  ],
});

test('five generated answers that omit a qualification are distinguished from service failures', async () => {
  let generations = 0;
  const output = await repeatCheck('What happened during Apollo 11?', claims, {
    generateJson: async (request) => {
      const input = JSON.parse(request.prompt);
      if (input.claims) {
        assert.equal(input.question, 'What happened during Apollo 11?');
        assert.match(request.system, /FIRST crewed landing/);
        assert.deepEqual(input.answers, Array(5).fill(answer));
        return comparison();
      }
      generations++;
      return { answer };
    },
  });
  const result = output.results.landing;
  assert.equal(generations, 5);
  assert.equal(result.generated, 5);
  assert.equal(result.completed, 0);
  assert.equal(result.unaddressed, 5);
  assert.equal(result.generationFailed, 0);
  assert.equal(result.comparisonFailed, 0);
  assert.ok(
    result.comparisons.every((item) => item.answer === answer && item.status === 'not_addressed'),
  );
  assert.match(
    agreementLabel(result),
    /5 answers generated; none addressed this complete statement/,
  );
  assert.doesNotMatch(agreementLabel(result), /unavailable|failed/);
});

test('failed generations retain safe error codes and are never described as omitted facts', async () => {
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      assert.equal(JSON.parse(request.prompt).claims, undefined);
      throw new AppError('Gemini usage limit reached.', 503, 'GEMINI_RATE_LIMIT');
    },
  });
  const result = output.results.landing;
  assert.equal(result.generated, 0);
  assert.equal(result.generationFailed, 5);
  assert.equal(result.unaddressed, 0);
  assert.equal(result.comparisons[0].errorCode, 'GEMINI_RATE_LIMIT');
  assert.match(agreementLabel(result), /No Gemini answers could be generated/);
});

test('comparison outages preserve all generated answers instead of pretending generation failed', async () => {
  let calls = 0;
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      if (JSON.parse(request.prompt).claims) {
        calls++;
        throw new AppError('Gemini usage limit reached.', 503, 'GEMINI_RATE_LIMIT');
      }
      return { answer };
    },
  });
  const result = output.results.landing;
  assert.equal(calls, 1);
  assert.equal(result.generated, 5);
  assert.equal(result.comparisonFailed, 5);
  assert.equal(result.generationFailed, 0);
  assert.equal(result.unaddressed, 0);
  assert.ok(
    result.comparisons.every(
      (item) => item.answer === answer && item.status === 'comparison_failed',
    ),
  );
  assert.match(agreementLabel(result), /5 answers generated; answer comparison was unavailable/);
});

test('a malformed comparison is repaired once without regenerating or changing the five answers', async () => {
  let generations = 0,
    comparisons = 0;
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      if (JSON.parse(request.prompt).claims) {
        comparisons++;
        return comparisons === 1 ? { claims: [] } : comparison(true);
      }
      generations++;
      return { answer };
    },
  });
  assert.equal(generations, 5);
  assert.equal(comparisons, 2);
  assert.equal(output.results.landing.completed, 5);
  assert.equal(output.results.landing.hits, 5);
});

test('repeated malformed comparisons stop after one repair and retain diagnostic answers', async () => {
  let comparisons = 0;
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      if (JSON.parse(request.prompt).claims) {
        comparisons++;
        return { claims: [] };
      }
      return { answer };
    },
  });
  assert.equal(comparisons, 2);
  assert.equal(output.results.landing.comparisonFailed, 5);
  assert.equal(output.results.landing.comparisons[0].errorCode, 'INVALID_AGREEMENT');
});

test('unknown errors never retain raw provider messages or private data', async () => {
  const output = await repeatCheck('Question?', claims, {
    generateJson: async () => {
      throw new Error('secret provider response: should-never-be-recorded');
    },
  });
  assert.doesNotMatch(JSON.stringify(output), /should-never-be-recorded|secret provider/);
  assert.equal(output.results.landing.generationFailed, 5);
});

test('mixed failures and missing content have separate counts and old results remain honestly unknown', async () => {
  let generation = 0;
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      if (JSON.parse(request.prompt).claims) return comparison();
      if (generation++ < 2) throw new AppError('Usage limit.', 503, 'GEMINI_RATE_LIMIT');
      return { answer };
    },
  });
  assert.equal(output.results.landing.generated, 3);
  assert.equal(output.results.landing.unaddressed, 3);
  assert.equal(output.results.landing.generationFailed, 2);
  assert.match(agreementLabel(output.results.landing), /3 answers generated.*2 generations failed/);
  const legacy = agreementLabel({ completed: 0, hits: 0, matches: Array(5).fill(null) });
  assert.match(legacy, /earlier check has no detailed comparison reasons/);
  assert.doesNotMatch(legacy, /generation.*failed|answers could not be generated/i);
});

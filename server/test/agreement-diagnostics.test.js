import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatCheck } from '../src/repeat.js';
import { AppError } from '../src/errors.js';
import { agreementLabel } from '../../client/src/agreement.js';
import { applySourceFallback, reviewAgreement } from '../src/agreementReview.js';
import { publicCheck } from '../src/workspace.js';

const claims = [
  { id: 'landing', claimText: 'The first crewed Moon landing took place in July 1969.' },
];
const answer = 'Armstrong and Aldrin landed on July 20, 1969.';
const review = () => ({
  comparisons: Array.from({ length: 5 }, (_, answerIndex) => ({
    answerIndex,
    status: 'needs_review',
    exactQuote: '',
    reason: 'First crewed landing is not established.',
  })),
});
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
      if (input.review) return review();
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
    result.comparisons.every((item) => item.answer === answer && item.status === 'needs_review'),
  );
  assert.match(agreementLabel(result), /5 checks need review/);
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
  assert.match(agreementLabel(result), /5 checks need review/);
});

test('comparison outages preserve all generated answers instead of pretending generation failed', async () => {
  let calls = 0;
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      if (JSON.parse(request.prompt).review)
        throw new AppError('Review unavailable.', 503, 'GEMINI_RATE_LIMIT');
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
      (item) => item.answer === answer && item.primaryStatus === 'comparison_failed',
    ),
  );
  assert.match(agreementLabel(result), /5 checks need review/);
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
      if (JSON.parse(request.prompt).review)
        throw new AppError('Review unavailable.', 503, 'GEMINI_RATE_LIMIT');
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
      if (JSON.parse(request.prompt).review) return review();
      if (JSON.parse(request.prompt).claims) return comparison();
      if (generation++ < 2) throw new AppError('Usage limit.', 503, 'GEMINI_RATE_LIMIT');
      return { answer };
    },
  });
  assert.equal(output.results.landing.generated, 3);
  assert.equal(output.results.landing.unaddressed, 3);
  assert.equal(output.results.landing.generationFailed, 2);
  assert.match(agreementLabel(output.results.landing), /5 checks need review/);
  const legacy = agreementLabel({ completed: 0, hits: 0, matches: Array(5).fill(null) });
  assert.match(legacy, /5 checks need review/);
  assert.doesNotMatch(legacy, /generation.*failed|answers could not be generated/i);
});

test('focused fallback corrects an omitted-return-date mistake using the actual answer quotation', async () => {
  const generated =
    'Neil Armstrong and Buzz Aldrin landed on the Moon on July 20. The three astronauts returned to Earth on July 24, 1969.';
  const quote = 'The three astronauts returned to Earth on July 24, 1969.';
  const returnClaims = [
    { id: 'return', claimText: 'The mission returned safely to Earth on July 24, 1969.' },
  ];
  let reviewCalls = 0;
  const output = await repeatCheck('What happened during Apollo 11?', returnClaims, {
    generateJson: async (request) => {
      const input = JSON.parse(request.prompt);
      if (input.review) {
        reviewCalls++;
        assert.equal(input.claim, returnClaims[0].claimText);
        assert.deepEqual(input.answers, Array(5).fill(generated));
        assert.equal(request.timeoutMs, 15000);
        assert.equal(request.maxRetries, 0);
        return {
          comparisons: Array.from({ length: 5 }, (_, answerIndex) => ({
            answerIndex,
            status: 'agreed',
            exactQuote: quote,
            reason: 'The return date is explicitly stated.',
          })),
        };
      }
      if (input.claims)
        return {
          claims: [
            {
              id: 'return',
              matches: Array(5).fill(null),
              reasons: Array(5).fill('Answer omits return date.'),
            },
          ],
        };
      return { answer: generated };
    },
  });
  assert.equal(reviewCalls, 1);
  assert.equal(output.results.return.hits, 5);
  assert.equal(output.results.return.completed, 5);
  assert.ok(output.results.return.comparisons.every((item) => item.reviewQuote === quote));
});

test('fallback cannot invent supporting quotes or turn source support into Gemini agreement', async () => {
  const output = await repeatCheck('Question?', claims, {
    generateJson: async (request) => {
      const input = JSON.parse(request.prompt);
      if (input.review)
        return {
          comparisons: Array.from({ length: 5 }, (_, answerIndex) => ({
            answerIndex,
            status: 'agreed',
            exactQuote: 'Invented quotation.',
            reason: 'Purported support.',
          })),
        };
      if (input.claims) return comparison();
      return { answer };
    },
  });
  assert.equal(output.results.landing.hits, 0);
  const supported = applySourceFallback(output.results.landing, { verdict: 'supported' });
  assert.equal(supported.sourceFallback, 5);
  assert.equal(supported.hits, 0);
  assert.ok(supported.comparisons.every((item) => item.status === 'source_supported'));
  assert.match(agreementLabel(supported), /Source fallback used for 5 checks/);
  const unresolved = applySourceFallback(
    { comparisons: [{ status: 'not_addressed' }] },
    { verdict: 'not_enough' },
  );
  assert.equal(unresolved.comparisons[0].status, 'needs_review');
});

test('browser and API snapshots contain check statuses without generated answer passages or review quotations', () => {
  const stored = {
    ownerId: 'private-owner',
    claims: [
      {
        repeatResult: {
          comparisons: [
            {
              status: 'agreed',
              answer: 'Private generated paragraph.',
              reviewQuote: 'Private excerpt.',
              reason: 'Return date matches.',
            },
          ],
        },
      },
    ],
  };
  const response = publicCheck(stored);
  assert.equal(response.ownerId, undefined);
  assert.equal(response.claims[0].repeatResult.comparisons[0].answer, undefined);
  assert.equal(response.claims[0].repeatResult.comparisons[0].reviewQuote, undefined);
  assert.equal(response.claims[0].repeatResult.comparisons[0].status, 'agreed');
  assert.equal(stored.claims[0].repeatResult.comparisons[0].answer, 'Private generated paragraph.');
});

test('focused review uses an alternate model when the preferred reviewer is unavailable', async () => {
  const models = [];
  const results = {
    landing: {
      comparisons: Array.from({ length: 5 }, () => ({
        status: 'not_addressed',
        answer,
        reason: 'Initial omission result.',
      })),
    },
  };
  await reviewAgreement(
    'Question?',
    claims,
    Array(5).fill(answer),
    results,
    {
      generateJson: async (request) => {
        models.push(request.model);
        if (request.model === 'preferred-reviewer')
          throw new AppError('Temporarily unavailable.', 503, 'GEMINI_UNAVAILABLE');
        return {
          comparisons: Array.from({ length: 5 }, (_, answerIndex) => ({
            answerIndex,
            status: 'agreed',
            exactQuote: answer,
            reason: 'The answer contains the statement.',
          })),
        };
      },
    },
    { GEMINI_JUDGE_MODEL: 'preferred-reviewer', GEMINI_REPEAT_MODEL: 'alternate-reviewer' },
  );
  assert.deepEqual(models, ['preferred-reviewer', 'alternate-reviewer']);
  assert.ok(
    results.landing.comparisons.every(
      (item) => item.status === 'agreed' && item.reviewModel === 'alternate-reviewer',
    ),
  );
});

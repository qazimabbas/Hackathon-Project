import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { publicSourceUrl, extractLinkedSource } from '../src/sources.js';
import { createPipeline } from '../src/pipeline.js';
import { locateClaims } from '../src/claims.js';
import { judgeEvidence } from '../src/evidence.js';
import { AppError } from '../src/errors.js';
import { createApp } from '../src/app.js';
import { cacheKey } from '../src/repository.js';
import { config } from '../src/config.js';

const url = 'https://example.com/article';
const source = {
  id: 'linked-source',
  title: 'Article',
  text: 'The article says Mars has two moons.',
  kind: 'link',
  url,
};
const completed = (pipeline, id) =>
  new Promise((resolve) => {
    const unsubscribe = pipeline.subscribe(id, (job) => {
      if (['complete', 'failed'].includes(job.status)) {
        unsubscribe();
        resolve(job);
      }
    });
  });

test('source URLs accept public HTTP(S) and reject credentials, private networks and non-web schemes', () => {
  assert.equal(publicSourceUrl(`${url}#chapter`), url);
  for (const value of [
    'file:///C:/private.txt',
    'javascript:alert(1)',
    'http://localhost/a',
    'http://127.1/a',
    'http://10.0.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fc00::1]',
    'http://intranet.local',
    'https://user:password@example.com',
    'http://example.com:3001',
  ])
    assert.equal(publicSourceUrl(value), null, value);
});

test('Tavily reads the selected URL through a fixed endpoint and retains full text and citation URL', async () => {
  const result = await extractLinkedSource(url, {
    key: 'test-key',
    fetchImpl: async (endpoint, options) => {
      assert.equal(endpoint, 'https://api.tavily.com/extract');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.urls, [url]);
      assert.equal(body.format, 'text');
      assert.equal(body.query, undefined);
      return Response.json({ results: [{ url, raw_content: source.text }], failed_results: [] });
    },
  });
  assert.equal(result.text, source.text);
  assert.equal(result.url, url);
  assert.equal(result.kind, 'link');
});

test('unreadable, empty and oversized linked pages fail clearly without substituting another source', async () => {
  for (const body of [
    { results: [], failed_results: [{ url, error: 'private upstream detail' }] },
    { results: [{ url, raw_content: ' ' }] },
  ])
    await assert.rejects(
      extractLinkedSource(url, { key: 'test-key', fetchImpl: async () => Response.json(body) }),
      { code: 'SOURCE_UNREADABLE' },
    );
  await assert.rejects(
    extractLinkedSource(url, {
      key: 'test-key',
      limit: 5,
      fetchImpl: async () => Response.json({ results: [{ url, raw_content: 'A long article.' }] }),
    }),
    { code: 'SOURCE_TOO_LONG' },
  );
  await assert.rejects(
    extractLinkedSource(url, { key: '', fetchImpl: () => assert.fail('No unauthenticated call') }),
    { code: 'SOURCE_KEY_MISSING' },
  );
});

test('contextual claims preserve exact highlights for terse numeric and paraphrased answers', () => {
  const answer =
    '**Served:** More than 2.5 million subcontienent citizens. **Died:** About 87,000.';
  const claims = locateClaims(answer, {
    claims: [
      {
        exactQuote: 'More than 2.5 million subcontienent citizens.',
        statement: 'More than 2.5 million people from the Indian subcontinent served in WWII.',
        kind: 'factual',
      },
      {
        exactQuote: 'About 87,000.',
        statement: 'About 87,000 Indians died in WWII.',
        kind: 'factual',
      },
    ],
  });
  assert.match(claims[1].verificationText, /died in WWII/);
  for (const claim of claims)
    assert.equal(answer.slice(claim.startIndex, claim.endIndex), claim.claimText);
});

test('malformed or unfinished evidence is retried once without weakening quote verification', async () => {
  let calls = 0;
  const result = await judgeEvidence('Mars has a pair of moons.', [source], {
    generateJson: async () => {
      calls++;
      if (calls === 1) throw new AppError('Unfinished response', 502, 'INCOMPLETE_LLM_OUTPUT');
      return {
        verdict: 'supported',
        reason: 'A pair means two.',
        sourceId: source.id,
        exactQuote: source.text,
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.verdict, 'supported');
  let failures = 0;
  await assert.rejects(
    judgeEvidence('Mars has moons.', [source], {
      generateJson: async () => {
        failures++;
        return { score: 10 };
      },
    }),
    { code: 'INVALID_EVIDENCE' },
  );
  assert.equal(failures, 2);
});

test('a rate-limited evidence model can fall back without bypassing source validation', async () => {
  const models = [];
  const result = await judgeEvidence('Mars has a pair of moons.', [source], {
    generateJson: async (request) => {
      models.push(request.model);
      if (models.length === 1) throw new AppError('Rate limited.', 503, 'GEMINI_RATE_LIMIT');
      return {
        verdict: 'supported',
        reason: 'The meaning is equivalent.',
        sourceId: source.id,
        exactQuote: source.text,
      };
    },
  });
  assert.deepEqual(models, [
    config.GEMINI_JUDGE_MODEL,
    config.GEMINI_JUDGE_FALLBACK_MODEL || config.GEMINI_REPEAT_MODEL,
  ]);
  assert.equal(result.verdict, 'supported');
  assert.ok(result.warnings.length);
  let calls = 0;
  const ungrounded = await judgeEvidence('Mars has three moons.', [source], {
    generateJson: async () => {
      if (calls++ === 0) throw new AppError('Rate limited.', 503, 'GEMINI_RATE_LIMIT');
      return {
        verdict: 'supported',
        reason: 'Model agreed.',
        sourceId: source.id,
        exactQuote: 'Mars has three moons.',
      };
    },
  });
  assert.equal(ungrounded.verdict, 'not_enough');
});

test('linked source loads once and uses contextual claims for judging', async () => {
  let loads = 0;
  const answerText = 'A pair.';
  const pipeline = createPipeline({
    loadSource: async (requested) => {
      loads++;
      assert.equal(requested, url);
      return source;
    },
    findCached: () => assert.fail('Mutable URL sources must be read afresh'),
    extractor: async () =>
      locateClaims(answerText, {
        claims: [{ exactQuote: answerText, statement: 'Mars has a pair of moons.' }],
      }),
    search: () => assert.fail('Do not replace the chosen source with a general search'),
    repeat: async (_question, claims, _provider, context) => {
      assert.equal(context.basis, 'source');
      assert.equal(context.documentText, source.text);
      assert.match(context.documentText, /two moons/);
      return {
        results: {
          [claims[0].id]: {
            matches: [true, true, true, true, true],
            completed: 5,
            hits: 5,
            basis: 'source',
          },
        },
      };
    },
    judge: async (claim, passages, _provider, context) => {
      assert.equal(claim, 'Mars has a pair of moons.');
      assert.equal(context.originalText, 'A pair.');
      assert.ok(passages.every((item) => item.kind === 'link'));
      assert.ok(passages.some((item) => item.kind === 'link' && item.url === url));
      return {
        verdict: 'supported',
        sourceKind: 'link',
        reason: 'Equivalent meaning.',
        evidenceSnippet: source.text,
      };
    },
  });
  const job = await pipeline.start({
    answerText,
    question: 'How many moons does Mars have?',
    documentText: '',
    sourceUrl: url,
  });
  const final = await completed(pipeline, job.id);
  assert.equal(loads, 1);
  assert.equal(final.claims[0].trustLevel, 'High');
  assert.equal(final.sourceUrl, url);
});

test('source read failures stop before paid extraction and retain a safe specific error', async () => {
  const pipeline = createPipeline({
    loadSource: async () => {
      throw new AppError('This page could not be read.', 422, 'SOURCE_UNREADABLE');
    },
    extractor: () => assert.fail('Must not extract from a different source'),
  });
  const initial = await pipeline.start({
    answerText: 'An answer.',
    question: 'Question?',
    documentText: '',
    sourceUrl: url,
  });
  const final = await completed(pipeline, initial.id);
  assert.equal(final.status, 'failed');
  assert.equal(final.error.code, 'SOURCE_UNREADABLE');
});

test('five matching answers cannot turn an unavailable evidence check into a trust judgment', async () => {
  const pipeline = createPipeline({
    extractor: async () => locateClaims('A claim.', { claims: [{ exactQuote: 'A claim.' }] }),
    judge: async () => {
      throw new AppError('The model response was unavailable.', 502, 'GEMINI_UNAVAILABLE');
    },
    repeat: async (_question, claims) => ({
      results: {
        [claims[0].id]: { completed: 5, hits: 5, matches: [true, true, true, true, true] },
      },
    }),
  });
  const job = await pipeline.start({
    answerText: 'A claim.',
    question: 'A question?',
    documentText: 'A reference.',
  });
  const final = await completed(pipeline, job.id);
  assert.equal(final.claims[0].status, 'error');
  assert.equal(final.claims[0].trustLevel, null);
  assert.equal(final.claims[0].verificationError.code, 'GEMINI_UNAVAILABLE');
  assert.equal(final.overallSummary.pending, 0);
  assert.equal(final.overallSummary.errors, 1);
});

test('API validates source URLs, and cache keys distinguish source links', async () => {
  const app = createApp({ checkSources: false, extractor: async () => [] });
  await supertest(app)
    .post('/api/checks')
    .send({ answerText: 'An answer.', sourceUrl: 'http://localhost:3001' })
    .expect(400);
  const response = await supertest(app)
    .post('/api/checks')
    .send({ answerText: 'An answer.', sourceUrl: url })
    .expect(202);
  assert.equal(response.body.check.sourceUrl, url);
  assert.notEqual(
    cacheKey({ answerText: 'An answer.' }),
    cacheKey({ answerText: 'An answer.', sourceUrl: url }),
  );
});

test('document and link are mutually exclusive before any cache or provider call', async () => {
  const input = { answerText: 'An answer.', documentText: 'A reference.', sourceUrl: url };
  const pipeline = createPipeline({
    findCached: () => assert.fail('Conflicting sources must not reach the cache'),
    extractor: () => assert.fail('Conflicting sources must not reach the provider'),
  });
  await assert.rejects(pipeline.start(input), { code: 'SOURCE_CONFLICT' });
  const app = createApp({ extractor: () => assert.fail('Do not call the provider') });
  const response = await supertest(app).post('/api/checks').send(input).expect(400);
  assert.equal(response.body.error.code, 'SOURCE_CONFLICT');
  assert.match(response.body.error.message, /either/);
});

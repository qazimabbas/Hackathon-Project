import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../src/pipeline.js';
import { locateClaims } from '../src/claims.js';

test('source verification finishes before supplementary agreement starts consuming provider quota', async () => {
  const order = [];
  const pipeline = createPipeline({
    extractor: async (input) =>
      locateClaims(input.answerText, {
        claims: [{ exactQuote: 'First fact.' }, { exactQuote: 'Second fact.' }],
      }),
    judge: async (claim) => {
      order.push(claim);
      return { verdict: 'supported', reason: 'Source support.' };
    },
    repeat: async () => {
      assert.equal(order.length, 2);
      order.push('agreement');
      return { results: {} };
    },
  });
  const job = await pipeline.start({
    answerText: 'First fact. Second fact.',
    question: 'What facts?',
    documentText: 'First fact. Second fact.',
  });
  await pipeline.wait(job.id);
  assert.equal(order.at(-1), 'agreement');
  assert.equal(pipeline.get(job.id).overallSummary.High, 2);
});

test('streams progressive evidence ratings, isolates a failed claim, and preserves Gemini agreement', async () => {
  const events = [];
  const pipeline = createPipeline({
    extractor: async (input) =>
      locateClaims(input.answerText, {
        claims: [{ exactQuote: 'The Moon orbits Earth.' }, { exactQuote: 'Mars is red.' }],
      }),
    judge: async (claim) => {
      if (claim.startsWith('Mars')) throw new Error('Failed provider');
      return {
        verdict: 'supported',
        reason: 'The supplied passage supports this.',
        evidenceSnippet: 'The Moon orbits Earth.',
      };
    },
    repeat: async (_question, claims) => ({
      answers: [],
      results: Object.fromEntries(
        claims.map((claim) => [
          claim.id,
          { matches: [true, true, true, true, true], hits: 5, completed: 5 },
        ]),
      ),
    }),
  });
  const initial = await pipeline.start({
    answerText: 'The Moon orbits Earth. Mars is red.',
    question: 'Tell me about the Moon and Mars.',
    documentText: 'The Moon orbits Earth.',
  });
  assert.equal(initial.status, 'queued');
  const final = await new Promise((resolve) => {
    const unsubscribe = pipeline.subscribe(initial.id, (snapshot) => {
      events.push(snapshot);
      if (snapshot.status === 'complete') {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
  assert.ok(events.some((event) => event.claims.some((claim) => claim.status === 'pending')));
  assert.equal(final.claims[0].trustLevel, 'High');
  assert.equal(final.claims[1].status, 'error');
  assert.equal(final.overallSummary.errors, 1);
  assert.ok(!JSON.stringify(final).includes('Failed provider'));
});

test('all source modes classify from evidence alone across disagreement, agreement and repeat failure', async () => {
  const answerText = 'A supported fact. A contradicted fact. An unresolved fact.';
  const expected = ['High', 'Low', 'Medium'];
  for (const mode of ['public', 'document', 'link']) {
    for (const hits of [0, 1, 5, null]) {
      const pipeline = createPipeline({
        extractor: async () =>
          locateClaims(answerText, {
            claims: answerText.match(/[^.]+\./g).map((text) => ({ exactQuote: text.trim() })),
          }),
        loadSource: async () => ({
          text: 'A reference.',
          kind: 'link',
          url: 'https://example.com/article',
        }),
        search: async () => ({ sources: [], warnings: [] }),
        judge: async (claim) => ({
          verdict: claim.includes('supported')
            ? 'supported'
            : claim.includes('contradicted')
              ? 'contradicted'
              : 'not_enough',
          sourceKind: mode === 'public' ? 'wikipedia' : mode,
          reason: 'Evidence assessment.',
        }),
        repeat: async (_question, claims) => {
          if (hits === null) throw new Error('Agreement service unavailable');
          return {
            results: Object.fromEntries(
              claims.map((claim) => [
                claim.id,
                {
                  hits,
                  completed: 5,
                  matches: Array.from({ length: 5 }, (_, index) => index < hits),
                },
              ]),
            ),
          };
        },
      });
      const job = await pipeline.start({
        answerText,
        question: 'What are the facts?',
        documentText: mode === 'document' ? 'A reference.' : '',
        sourceUrl: mode === 'link' ? 'https://example.com/article' : '',
      });
      const final = await new Promise((resolve) => {
        const stop = pipeline.subscribe(job.id, (snapshot) => {
          if (snapshot.status === 'complete') {
            stop();
            resolve(snapshot);
          }
        });
      });
      assert.deepEqual(
        final.claims.map((claim) => claim.trustLevel),
        expected,
        `${mode}: ${hits} matches`,
      );
      assert.equal(final.trustPolicy, 'evidence-only-v1');
      assert.equal(final.claims[0].repeatResult.hits, hits ?? 0);
      assert.equal(final.claims[0].repeatResult.completed, hits === null ? 0 : 5);
    }
  }
});

test('evidence ratings stream before supplementary Gemini answers finish', async () => {
  let finishAgreement;
  const agreementGate = new Promise((resolve) => {
    finishAgreement = resolve;
  });
  const pipeline = createPipeline({
    extractor: async (input) =>
      locateClaims(input.answerText, { claims: [{ exactQuote: input.answerText }] }),
    search: async () => ({ sources: [], warnings: [] }),
    judge: async () => ({ verdict: 'supported', sourceKind: 'wikipedia', reason: 'Supported.' }),
    repeat: async () => {
      await agreementGate;
      return { results: {} };
    },
  });
  const job = await pipeline.start({
    answerText: 'A supported fact.',
    question: 'A question?',
    documentText: '',
  });
  await new Promise((resolve) => {
    const stop = pipeline.subscribe(job.id, (snapshot) => {
      if (snapshot.claims[0]?.trustLevel === 'High') {
        stop();
        assert.equal(snapshot.status, 'checking');
        assert.equal(snapshot.claims[0].repeatResult, undefined);
        resolve();
      }
    });
  });
  const completed = new Promise((resolve) => {
    const stop = pipeline.subscribe(job.id, (snapshot) => {
      if (snapshot.status === 'complete') {
        stop();
        resolve(snapshot);
      }
    });
  });
  finishAgreement();
  const final = await completed;
  assert.equal(final.claims[0].trustLevel, 'High');
  assert.equal(final.claims[0].repeatResult.completed, 0);
});

test('marks inferred questions and keeps a clear warning', async () => {
  const pipeline = createPipeline({
    extractor: async (input) =>
      locateClaims(input.answerText, { claims: [{ exactQuote: 'Earth is round.' }] }),
    infer: async () => 'What shape is Earth?',
    repeat: async () => ({ results: {} }),
    judge: async () => ({ verdict: 'not_enough', reason: 'No proof found.' }),
  });
  const job = await pipeline.start({
    answerText: 'Earth is round.',
    question: '',
    documentText: 'A document.',
  });
  const final = await new Promise((resolve) => {
    const stop = pipeline.subscribe(job.id, (snapshot) => {
      if (snapshot.status === 'complete') {
        stop();
        resolve(snapshot);
      }
    });
  });
  assert.equal(final.questionInferred, true);
  assert.equal(final.inferredQuestion, 'What shape is Earth?');
  assert.ok(final.warnings.some((text) => /less accurate/.test(text)));
});

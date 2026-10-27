import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../src/pipeline.js';
import { locateClaims } from '../src/claims.js';

test('streams progressive results, isolates a failed claim, and combines five repeats', async () => {
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

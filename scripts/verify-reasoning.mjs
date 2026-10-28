import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPipeline } from '../server/src/pipeline.js';

// Explicit live verification uses Gemini quota. No database or web search is required.
const cases = [
  {
    name: 'correct calculation',
    trust: 'High',
    type: 'calculation',
    input: {
      question: 'What was the total cost including delivery?',
      documentText: 'A shop bought 12 notebooks at $15 each. Delivery cost $20.',
      answerText: 'The total cost including delivery was $200.',
    },
  },
  {
    name: 'incorrect calculation',
    trust: 'Low',
    type: 'calculation',
    input: {
      question: 'What was the total cost including delivery?',
      documentText: 'A shop bought 12 notebooks at $15 each. Delivery cost $20.',
      answerText: 'The total cost including delivery was $220.',
    },
  },
  {
    name: 'appropriate abstention',
    trust: 'High',
    type: 'abstention',
    input: {
      question: 'What was the profit in 2025?',
      documentText: 'Revenue was $200 in 2024 and $250 in 2025.',
      answerText: 'I cannot calculate 2025 profit from the information in the document.',
    },
  },
  {
    name: 'unjustified abstention',
    trust: 'Low',
    type: 'abstention',
    input: {
      question: 'What was the profit in 2025?',
      documentText: 'Revenue was $250 in 2025. Total costs were $150 in 2025.',
      answerText: 'I cannot calculate 2025 profit from the information in the document.',
    },
  },
];
const pipeline = createPipeline();
const results = [];
for (const scenario of cases) {
  const initial = await pipeline.start(scenario.input);
  const result = await new Promise((resolve) => {
    const unsubscribe = pipeline.subscribe(initial.id, (job) => {
      if (['complete', 'failed'].includes(job.status)) {
        unsubscribe();
        resolve(job);
      }
    });
  });
  results.push({ name: scenario.name, result });
  await mkdir('.local', { recursive: true });
  await writeFile('.local/live-reasoning-checks.json', JSON.stringify(results, null, 2));
  assert.equal(result.status, 'complete', result.error?.message);
  assert.ok(result.claims.length > 0, `${scenario.name}: at least one assessable statement`);
  for (const claim of result.claims) {
    assert.equal(claim.status, 'complete', `${scenario.name}: evidence check completes`);
    assert.equal(claim.sourceResult.assessmentType, scenario.type, scenario.name);
    assert.equal(claim.trustLevel, scenario.trust, scenario.name);
    assert.equal(claim.repeatResult.basis, 'document');
    assert.equal(
      claim.repeatResult.completed,
      5,
      `${scenario.name}: five comparable fresh answers`,
    );
  }
  console.log(
    `${scenario.name}: ${scenario.trust}, ${scenario.type}, five document-based answers checked.`,
  );
}
console.log(
  'Real Gemini reasoning checks passed. Results saved in .local/live-reasoning-checks.json.',
);

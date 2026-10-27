import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { locateClaims } from '../src/claims.js';

async function finished(app, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await supertest(app).get(`/api/checks/${id}`).expect(200);
    if (['complete', 'failed'].includes(response.body.check.status)) return response.body.check;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Check did not finish.');
}

test('accepts valid input and returns exact statements without inventing trust levels', async () => {
  const app = createApp({
    checkSources: false,
    extractor: async (input) =>
      locateClaims(input.answerText, { claims: [{ exactQuote: 'The Moon orbits Earth.' }] }),
  });
  const response = await supertest(app)
    .post('/api/checks')
    .send({ answerText: 'The Moon orbits Earth.' })
    .expect(202);
  const check = await finished(app, response.body.id);
  assert.equal(check.claims[0].trustLevel, null);
  assert.equal(check.claims[0].startIndex, 0);
  assert.equal(check.documentText, '');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('rejects whitespace, oversized inputs, and non-string input before calling Gemini', async () => {
  let calls = 0;
  const app = createApp({
    rateLimitMax: 100,
    extractor: async () => {
      calls++;
      return [];
    },
  });
  for (const body of [
    { answerText: '   ' },
    { answerText: 'a'.repeat(12001) },
    { answerText: 123 },
    { answerText: 'A', documentText: 'a'.repeat(60001) },
    { answerText: 'A', question: 'a'.repeat(2001) },
    { answerText: 'A', unexpected: true },
  ]) {
    await supertest(app).post('/api/checks').send(body).expect(400);
  }
  assert.equal(calls, 0);
});

test('rate limiting blocks additional live calls but leaves the saved example available', async () => {
  let calls = 0;
  const app = createApp({
    rateLimitMax: 1,
    extractor: async () => {
      calls++;
      return [];
    },
  });
  await supertest(app).post('/api/checks').send({ answerText: 'A' }).expect(202);
  await supertest(app).post('/api/checks').send({ answerText: 'A' }).expect(429);
  const response = await supertest(app).get('/api/example').expect(200);
  assert.equal(response.body.check.claims.length, 5);
  assert.equal(calls, 1);
});

test('health exposes configuration status without any credentials', async () => {
  const response = await supertest(createApp()).get('/api/health').expect(200);
  assert.equal(response.body.name, 'Hallucination Visualizer');
  assert.equal(typeof response.body.llmConfigured, 'boolean');
  assert.ok(!JSON.stringify(response.body).includes('mongodb+srv'));
  assert.ok(!Object.keys(response.body).some((key) => /key|uri|password/i.test(key)));
});

test('malformed request JSON and unknown API paths have clear errors', async () => {
  const app = createApp();
  await supertest(app)
    .post('/api/checks')
    .set('Content-Type', 'application/json')
    .send('{broken')
    .expect(400);
  await supertest(app).get('/api/no-such-route').expect(404);
});

test('unexpected server errors never reveal sensitive details', async () => {
  const app = createApp({
    extractor: async () => {
      throw new Error('mongodb+srv://private:secret@host');
    },
  });
  const response = await supertest(app).post('/api/checks').send({ answerText: 'A' }).expect(202);
  const check = await finished(app, response.body.id);
  assert.ok(!JSON.stringify(check).includes('private'));
  assert.equal(check.error.code, 'CHECK_FAILED');
});

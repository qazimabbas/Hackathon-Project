import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { cacheKey } from '../src/repository.js';
import { example } from '../../shared/example.js';

test('cache keys include all inputs and do not expose the supplied text', () => {
  const key = cacheKey(example);
  assert.equal(key.length, 64);
  assert.notEqual(cacheKey({ ...example, documentText: 'A different source' }), key);
  assert.notEqual(cacheKey({ ...example, question: 'A different question' }), key);
  assert.notEqual(cacheKey({ ...example, answerText: 'A different answer' }), key);
});

test('cached checks return immediately without running the extraction pipeline', async () => {
  const app = createApp({
    extractor: () => {
      assert.fail('Cache must avoid paid calls');
    },
    repository: { findCached: async () => example },
  });
  const response = await supertest(app)
    .post('/api/checks')
    .send({
      answerText: example.answerText,
      question: example.question,
      documentText: example.documentText,
    })
    .expect(200);
  assert.equal(response.body.check.cached, true);
});

test('history, stats, reopening, and sharing use the repository and validate pagination', async () => {
  const token = 'a'.repeat(48);
  const app = createApp({
    repository: {
      get: async (id) => (id === example.id ? example : null),
      history: async (page) => ({ checks: [example], total: 1, page }),
      stats: async () => ({ checks: 1, claims: 5, High: 3, Medium: 0, Low: 2, trend: [] }),
      share: async () => token,
      shared: async (value) =>
        value === token ? { ...example, documentText: undefined, readOnly: true } : null,
    },
  });
  await supertest(app).get('/api/checks?page=0').expect(400);
  const history = await supertest(app).get('/api/checks?page=1').expect(200);
  assert.equal(history.body.total, 1);
  await supertest(app).get(`/api/checks/${example.id}`).expect(200);
  const stats = await supertest(app).get('/api/stats').expect(200);
  assert.equal(stats.body.High, 3);
  const share = await supertest(app).post(`/api/checks/${example.id}/share`).expect(200);
  assert.ok(share.body.path.endsWith(token));
  const shared = await supertest(app).get(`/api/shared/${token}`).expect(200);
  assert.equal(shared.body.check.documentText, undefined);
  assert.equal(shared.body.check.readOnly, true);
});

test('a completed result can be replayed through SSE after its original process ends', async () => {
  const app = createApp({ repository: { get: async () => example } });
  const response = await supertest(app).get(`/api/checks/${example.id}/stream`).expect(200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.match(response.text, /event: snapshot/);
  assert.match(response.text, /"status":"complete"/);
});

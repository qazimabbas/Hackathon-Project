import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { createPipeline } from '../src/pipeline.js';
import { createJobStore } from '../src/jobs.js';
import { createRepository, cacheKey } from '../src/repository.js';
import { locateClaims } from '../src/claims.js';
import { readCheckStream } from '../../client/src/checkStream.js';

function memoryJobs() {
  const records = new Map();
  return {
    records,
    save: async (check) => records.set(check.id, structuredClone(check)),
    get: async (id, ownerId) => {
      const record = records.get(id);
      return record && (!ownerId || record.ownerId === ownerId) ? structuredClone(record) : null;
    },
  };
}

test('hosted POST streams progress and completes its job before ending the response', async () => {
  const jobs = memoryJobs();
  let saved;
  const app = createApp({
    streamChecks: true,
    jobStore: jobs,
    checkSources: false,
    extractor: async (input) =>
      locateClaims(input.answerText, { claims: [{ exactQuote: input.answerText }] }),
    repository: {
      findCached: async () => null,
      save: async (check) => {
        saved = check;
      },
    },
  });
  const response = await supertest(app)
    .post('/api/checks')
    .set('Accept', 'text/event-stream')
    .send({ answerText: 'The Moon orbits Earth.' })
    .expect(200)
    .expect('Content-Type', /text\/event-stream/);
  const events = [];
  await readCheckStream(new Response(response.text), (check) => events.push(check));
  assert.equal(events[0].status, 'queued');
  assert.ok(events.some((check) => check.claims[0]?.status === 'pending'));
  assert.equal(events.at(-1).status, 'complete');
  assert.equal(saved.id, events[0].id);
  assert.equal(jobs.records.get(saved.id).status, 'complete');
  const anotherInstance = createApp({ jobStore: jobs });
  const reopened = await supertest(anotherInstance).get(`/api/checks/${saved.id}`).expect(200);
  assert.equal(reopened.body.check.status, 'complete');
  const replay = await supertest(anotherInstance).get(`/api/checks/${saved.id}/stream`).expect(200);
  assert.match(replay.text, /"status":"complete"/);
});

test('hosted browser sessions isolate checks and private history across warm and cold instances', async () => {
  const jobs = memoryJobs();
  const privateOptions = { privateWorkspaces: true, sessionSecret: 's'.repeat(64), jobStore: jobs };
  const app = createApp({
    ...privateOptions,
    streamChecks: true,
    checkSources: false,
    extractor: async () => [],
  });
  const response = await supertest(app)
    .post('/api/checks')
    .send({ answerText: 'My private answer.' })
    .expect(200);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  assert.match(response.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.body.check.ownerId, undefined);
  const { id } = response.body;
  const ownerId = jobs.records.get(id).ownerId;
  assert.match(ownerId, /^[a-f0-9]{64}$/);
  await supertest(app).get(`/api/checks/${id}`).set('Cookie', cookie).expect(200);
  await supertest(app).get(`/api/checks/${id}`).expect(404);
  await supertest(app).get(`/api/checks/${id}/stream`).expect(404);
  await supertest(app)
    .get(`/api/checks/${id}`)
    .set('Cookie', cookie.replace(/.$/, 'z'))
    .expect(404);
  const cold = createApp({
    ...privateOptions,
    repository: {
      get: async (_id, workspace) => {
        assert.ok(workspace);
        return null;
      },
      history: async (_page, workspace) => {
        assert.ok(workspace);
        return {
          checks: workspace === ownerId ? [{ id }] : [],
          total: workspace === ownerId ? 1 : 0,
        };
      },
      stats: async (workspace) => ({ checks: workspace === ownerId ? 1 : 0 }),
    },
  });
  await supertest(cold).get(`/api/checks/${id}`).set('Cookie', cookie).expect(200);
  await supertest(cold).get(`/api/checks/${id}`).expect(404);
  const history = await supertest(cold).get('/api/checks').set('Cookie', cookie).expect(200);
  assert.equal(history.body.privateWorkspace, true);
  assert.equal(history.body.total, 1);
  const outsider = await supertest(cold).get('/api/checks').expect(200);
  assert.equal(outsider.body.total, 0);
  assert.equal((await supertest(cold).get('/api/stats').expect(200)).body.checks, 0);
  assert.notEqual(
    cacheKey({ answerText: 'Same answer', ownerId }),
    cacheKey({ answerText: 'Same answer', ownerId: 'another-browser' }),
  );
});

test('Atlas queries scope history, statistics, reads and sharing to the hosted browser workspace', async () => {
  const seen = [];
  const chain = {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    async lean() {
      return [];
    },
  };
  const repository = createRepository({
    modelProvider: async () => ({
      findOne: (query) => {
        seen.push(query);
        return { select: () => ({ lean: async () => null }) };
      },
      find: (query) => {
        seen.push(query);
        return chain;
      },
      countDocuments: async (query) => {
        seen.push(query);
        return 0;
      },
      aggregate: async (stages) => {
        seen.push(stages[0].$match);
        return [];
      },
    }),
  });
  await repository.get('private-check', 'browser-workspace');
  await repository.history(1, 'browser-workspace');
  await repository.stats('browser-workspace');
  assert.ok(seen.every((query) => query.ownerId === 'browser-workspace'));
  assert.equal(seen.length, 5);
});

test('hosted JSON callers wait for completion instead of abandoning background work', async () => {
  const app = createApp({
    streamChecks: true,
    jobStore: memoryJobs(),
    checkSources: false,
    extractor: async () => [],
  });
  const response = await supertest(app)
    .post('/api/checks')
    .send({ answerText: 'An answer.' })
    .expect(200);
  assert.equal(response.body.check.status, 'complete');
});

test('hosted checks fail before provider calls if initial durable storage is unavailable', async () => {
  const app = createApp({
    streamChecks: true,
    jobStore: createJobStore({
      modelProvider: async () => {
        throw new Error('private database details');
      },
    }),
    extractor: () => assert.fail('Do not charge for a job that cannot be stored'),
  });
  const response = await supertest(app)
    .post('/api/checks')
    .set('Accept', 'text/event-stream')
    .send({ answerText: 'An answer.' })
    .expect(503);
  assert.equal(response.body.error.code, 'JOB_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.body).includes('private database details'));
});

test('progress writes remain ordered under concurrent evidence checks', async () => {
  let writing = 0,
    overlap = false;
  const snapshots = [];
  const pipeline = createPipeline({
    extractor: async (input) =>
      locateClaims(input.answerText, {
        claims: [{ exactQuote: 'First fact.' }, { exactQuote: 'Second fact.' }],
      }),
    search: async () => ({ sources: [], warnings: [] }),
    judge: async () => ({ verdict: 'supported', reason: 'Supported.' }),
    repeat: async () => ({ results: {} }),
    jobStore: {
      save: async (snapshot) => {
        writing++;
        if (writing > 1) overlap = true;
        await new Promise((resolve) => setTimeout(resolve, 2));
        snapshots.push(structuredClone(snapshot));
        writing--;
      },
    },
  });
  const job = await pipeline.start({
    answerText: 'First fact. Second fact.',
    question: 'What facts?',
    documentText: '',
  });
  await pipeline.wait(job.id);
  assert.equal(overlap, false);
  assert.equal(snapshots[0].status, 'queued');
  assert.equal(snapshots.at(-1).status, 'complete');
  assert.equal(snapshots.at(-1).overallSummary.High, 2);
});

test('durable jobs expire and interrupted invocations become a clear timeout without downgrading completed evidence', async () => {
  const records = new Map();
  const start = Date.parse('2026-10-28T00:00:00Z');
  let now = start;
  const store = createJobStore({
    now: () => now,
    modelProvider: async () => ({
      updateOne: async ({ id }, update) => records.set(id, structuredClone(update.$set)),
      findOne: ({ id }) => ({ lean: async () => structuredClone(records.get(id) || null) }),
    }),
  });
  await store.save({
    id: 'active',
    createdAt: new Date(start).toISOString(),
    status: 'checking',
    claims: [
      { id: 'done', status: 'complete', trustLevel: 'High' },
      { id: 'pending', status: 'pending', trustLevel: null },
    ],
  });
  assert.equal((await store.get('active')).status, 'checking');
  now = start + 316000;
  const timedOut = await store.get('active');
  assert.equal(timedOut.error.code, 'CHECK_TIMEOUT');
  assert.equal(timedOut.claims[0].trustLevel, 'High');
  assert.equal(timedOut.claims[1].status, 'error');
  assert.equal(timedOut.overallSummary.errors, 1);
  now = start + 86400001;
  assert.equal(await store.get('active'), null);
});

test('POST stream parser handles byte boundaries, Unicode and heartbeats and rejects unfinished streams', async () => {
  const encoder = new TextEncoder();
  const payload =
    ': keep-alive\r\n\r\nevent: snapshot\r\ndata: {"status":"checking","text":"Moon 🌙"}\r\n\r\nevent: snapshot\r\ndata: {"status":"complete"}\r\n\r\n';
  const bytes = encoder.encode(payload);
  const seen = [];
  await readCheckStream(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
    ),
    (check) => seen.push(check),
  );
  assert.equal(seen[0].text, 'Moon 🌙');
  assert.equal(seen.at(-1).status, 'complete');
  await assert.rejects(
    readCheckStream(new Response('event: snapshot\ndata: {"status":"checking"}\n\n'), () => {}),
    /connection ended/i,
  );
});

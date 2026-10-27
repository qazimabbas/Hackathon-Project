import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/llm.js';

const settings = {
  GEMINI_API_KEY: 'unit-test-secret',
  GEMINI_EXTRACT_MODEL: 'test-model',
  LLM_MAX_RETRIES: 2,
  LLM_TIMEOUT_MS: 1000,
};
const request = { system: 'Extract claims.', prompt: 'Text', schema: { type: 'object' } };
const good = () =>
  Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"claims":[]}' }] } }],
  });

test('keeps the secret in a request header and never in the URL', async () => {
  const llm = createLlm({
    settings,
    fetchImpl: async (url, options) => {
      assert.ok(!url.includes(settings.GEMINI_API_KEY));
      assert.equal(options.headers['x-goog-api-key'], settings.GEMINI_API_KEY);
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.deepEqual(body.generationConfig.responseJsonSchema, request.schema);
      return good();
    },
  });
  assert.deepEqual(await llm.generateJson(request), { claims: [] });
});

test('retries temporary failures with a bounded Retry-After delay', async () => {
  let calls = 0;
  const waits = [];
  const llm = createLlm({
    settings,
    sleep: async (ms) => waits.push(ms),
    fetchImpl: async () =>
      ++calls === 1
        ? new Response('busy', { status: 429, headers: { 'retry-after': '600' } })
        : good(),
  });
  await llm.generateJson(request);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10000]);
});

test('does not retry authentication errors or expose upstream response text', async () => {
  let calls = 0;
  const llm = createLlm({
    settings,
    fetchImpl: async () => {
      calls++;
      return new Response('secret upstream body: unit-test-secret', { status: 403 });
    },
  });
  await assert.rejects(
    llm.generateJson(request),
    (error) => error.code === 'GEMINI_ACCESS' && !error.message.includes('unit-test-secret'),
  );
  assert.equal(calls, 1);
});

test('stops after the configured retry budget on network failure', async () => {
  let calls = 0;
  const llm = createLlm({
    settings,
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      throw new Error('raw network secret');
    },
  });
  await assert.rejects(llm.generateJson(request), { code: 'GEMINI_CONNECTION' });
  assert.equal(calls, 3);
});

test('rejects unfinished output, invalid JSON, and missing credentials', async () => {
  const noKey = createLlm({ settings: { ...settings, GEMINI_API_KEY: '' } });
  await assert.rejects(noKey.generateJson(request), { code: 'MISSING_GEMINI_KEY' });
  for (const [body, code] of [
    [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'INCOMPLETE_LLM_OUTPUT'],
    [
      { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }] },
      'INVALID_LLM_JSON',
    ],
  ]) {
    const llm = createLlm({ settings, fetchImpl: async () => Response.json(body) });
    await assert.rejects(llm.generateJson(request), { code });
  }
});

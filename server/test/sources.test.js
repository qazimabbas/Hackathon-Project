import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wikipediaSources, tavilySources, searchEvidence, safeSourceUrl } from '../src/sources.js';

test('Wikipedia returns plain source passages and real article links without a key', async () => {
  const sources = await wikipediaSources('The Moon orbits Earth.', {
    fetchImpl: async (url) => {
      assert.match(url, /explaintext=1/);
      assert.ok(!url.includes('key='));
      return Response.json({
        query: {
          pages: [
            {
              pageid: 1,
              title: 'Moon',
              extract: 'The Moon orbits Earth.',
              fullurl: 'https://en.wikipedia.org/wiki/Moon',
            },
          ],
        },
      });
    },
  });
  assert.equal(sources[0].kind, 'wikipedia');
  assert.equal(sources[0].text, 'The Moon orbits Earth.');
});

test('Tavily uses a private authorization header and drops unsafe source links', async () => {
  const sources = await tavilySources('Moon', {
    key: 'test-search-secret',
    fetchImpl: async (url, options) => {
      assert.ok(!url.includes('test-search-secret'));
      assert.equal(options.headers.Authorization, 'Bearer test-search-secret');
      return Response.json({
        results: [
          { title: 'Moon', url: 'https://example.com/moon', content: 'A source.' },
          { url: 'javascript:alert(1)', content: 'Not a link.' },
        ],
      });
    },
  });
  assert.equal(sources.length, 1);
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
});

test('one unavailable service does not hide other evidence and reports a warning', async () => {
  const result = await searchEvidence('claim', {
    useWeb: true,
    wiki: async () => {
      throw new Error('private error');
    },
    web: async () => [{ id: 'web', text: 'evidence' }],
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.warnings.length, 1);
  await assert.rejects(
    searchEvidence('claim', {
      useWeb: false,
      wiki: async () => {
        throw new Error('private');
      },
    }),
    { code: 'ALL_SOURCES_FAILED' },
  );
});

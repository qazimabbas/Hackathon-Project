import { setTimeout as delay } from 'node:timers/promises';
import { config, hasSecret } from './config.js';
import { AppError } from './errors.js';
import { BlockList, isIP } from 'node:net';

const privateNetworks = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  privateNetworks.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['::ffff:0:0', 96],
])
  privateNetworks.addSubnet(network, prefix, 'ipv6');

export function publicSourceUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (!hostname.includes('.') && !isIP(hostname)) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname)
    )
      return null;
    const family = isIP(hostname);
    if (family && privateNetworks.check(hostname, family === 4 ? 'ipv4' : 'ipv6')) return null;
    if (url.port && !['80', '443'].includes(url.port)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

const userAgent = 'HallucinationVisualizer/1.0 (local evidence reader)';
export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

async function fetchJson(url, options, fetchImpl, sleep, timeoutMs = 12000) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        await response.body?.cancel();
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new AppError(
          'A source service could not be reached or did not accept its settings.',
          502,
          'SOURCE_ACCESS',
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (attempt < 2) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new AppError(
        'A source service did not respond. This statement may need another check.',
        502,
        'SOURCE_CONNECTION',
      );
    }
  }
}

export async function extractLinkedSource(
  sourceUrl,
  {
    fetchImpl = fetch,
    sleep = delay,
    key = config.TAVILY_API_KEY,
    limit = config.MAX_DOCUMENT_CHARS,
  } = {},
) {
  const requestedUrl = publicSourceUrl(sourceUrl);
  if (!requestedUrl)
    throw new AppError(
      'Use a public http:// or https:// article, website, or readable book URL.',
      400,
      'INVALID_SOURCE_URL',
    );
  if (!hasSecret(key))
    throw new AppError(
      'Add TAVILY_API_KEY on the server to read source links. Document import and pasted text still work.',
      503,
      'SOURCE_KEY_MISSING',
    );
  const body = await fetchJson(
    'https://api.tavily.com/extract',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        urls: [requestedUrl],
        extract_depth: 'advanced',
        format: 'text',
        include_images: false,
        timeout: 20,
      }),
    },
    fetchImpl,
    sleep,
    30000,
  );
  const result = body.results?.find(
    (item) =>
      typeof item.raw_content === 'string' && item.raw_content.trim() && publicSourceUrl(item.url),
  );
  if (!result)
    throw new AppError(
      'This source could not be read. It may require a login, block access, or expose only a book preview. Upload the document or paste the relevant text instead.',
      422,
      'SOURCE_UNREADABLE',
    );
  const text = result.raw_content.trim();
  if (text.length > limit)
    throw new AppError(
      `This linked page exceeds the ${limit.toLocaleString()} character source limit. Paste the relevant chapter or passages, or use a shorter source link.`,
      422,
      'SOURCE_TOO_LONG',
    );
  return {
    id: 'linked-source',
    title: String(result.title || new URL(result.url).hostname).slice(0, 200),
    text,
    kind: 'link',
    url: publicSourceUrl(result.url),
    requestedUrl,
  };
}

export async function wikipediaSources(claimText, { fetchImpl = fetch, sleep = delay } = {}) {
  const query = claimText
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .slice(0, 220);
  const parameters = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '3',
    gsrnamespace: '0',
    prop: 'extracts|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    exchars: '1200',
    exlimit: '3',
  });
  let body = await fetchJson(
    `https://en.wikipedia.org/w/api.php?${parameters}`,
    { headers: { 'User-Agent': userAgent, Accept: 'application/json' } },
    fetchImpl,
    sleep,
  );
  if (body.error)
    throw new AppError('Wikipedia could not complete this search.', 502, 'WIKIPEDIA_SEARCH');
  if (!body.query?.pages?.length) {
    parameters.set(
      'gsrsearch',
      query
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 4)
        .join(' '),
    );
    body = await fetchJson(
      `https://en.wikipedia.org/w/api.php?${parameters}`,
      { headers: { 'User-Agent': userAgent, Accept: 'application/json' } },
      fetchImpl,
      sleep,
    );
    if (body.error)
      throw new AppError('Wikipedia could not complete this search.', 502, 'WIKIPEDIA_SEARCH');
  }
  return (body.query?.pages || [])
    .filter((page) => typeof page.extract === 'string' && page.extract.trim())
    .map((page) => ({
      id: `wiki-${page.pageid}`,
      title: String(page.title).slice(0, 200),
      text: page.extract.slice(0, 1800),
      kind: 'wikipedia',
      url: safeSourceUrl(page.fullurl),
    }))
    .slice(0, 3);
}

export async function tavilySources(
  claimText,
  { fetchImpl = fetch, sleep = delay, key = config.TAVILY_API_KEY } = {},
) {
  if (!hasSecret(key)) return [];
  const body = await fetchJson(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: claimText.slice(0, 400),
        search_depth: 'basic',
        max_results: 3,
        include_answer: false,
        include_raw_content: false,
      }),
    },
    fetchImpl,
    sleep,
  );
  if (!Array.isArray(body.results))
    throw new AppError('The web search response could not be read.', 502, 'INVALID_SEARCH');
  return body.results
    .filter(
      (item) => typeof item.content === 'string' && item.content.trim() && safeSourceUrl(item.url),
    )
    .slice(0, 3)
    .map((item, index) => ({
      id: `web-${index}`,
      title: String(item.title || 'Web source').slice(0, 200),
      text: item.content.slice(0, 2400),
      kind: 'web',
      url: safeSourceUrl(item.url),
    }));
}

export async function searchEvidence(
  claimText,
  { wiki = wikipediaSources, web = tavilySources, useWeb = hasSecret(config.TAVILY_API_KEY) } = {},
) {
  const results = await Promise.allSettled([wiki(claimText), ...(useWeb ? [web(claimText)] : [])]);
  const sources = [],
    warnings = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') sources.push(...result.value);
    else
      warnings.push(
        `${index === 0 ? 'Wikipedia' : 'Web search'} could not be reached or did not accept its settings.`,
      );
  });
  if (results.every((result) => result.status === 'rejected'))
    throw new AppError(
      'The source services could not be reached. This statement could not be checked.',
      502,
      'ALL_SOURCES_FAILED',
    );
  return { sources, warnings };
}

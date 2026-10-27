import { z } from 'zod';
import { config } from './config.js';
import { llm } from './llm.js';
import { evidenceInstruction, evidencePrompt } from './prompts.js';
import { AppError } from './errors.js';

const schema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['supported', 'contradicted', 'not_enough'] },
    reason: { type: 'string' },
    sourceId: { type: 'string' },
    exactQuote: { type: 'string' },
  },
  required: ['verdict', 'reason', 'sourceId', 'exactQuote'],
  additionalProperties: false,
};
const validator = z
  .object({
    verdict: z.enum(['supported', 'contradicted', 'not_enough']),
    reason: z.string().min(1).max(600),
    sourceId: z.string().max(200),
    exactQuote: z.string().max(4000),
  })
  .strict();
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

// Sparse, local word vectors keep long documents out of full repeated prompts.
// Short documents are passed whole. Retrieval does not add any external facts.
export function documentSources(documentText, claimText) {
  if (documentText.length <= 12000)
    return [
      { id: 'document', title: 'Your document', text: documentText, kind: 'document', url: null },
    ];
  const chunks = [];
  for (let start = 0; start < documentText.length; start += 1400)
    chunks.push({ text: documentText.slice(start, start + 1800), start });
  const frequencies = new Map();
  const vectors = chunks.map((chunk) => {
    const vector = new Map();
    for (const term of words(chunk.text)) vector.set(term, (vector.get(term) || 0) + 1);
    for (const term of vector.keys()) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    return vector;
  });
  const query = new Set(words(claimText));
  return chunks
    .map((chunk, index) => {
      let dot = 0,
        length = 0,
        queryLength = 0;
      for (const term of query)
        queryLength += Math.log(1 + chunks.length / (1 + (frequencies.get(term) || 0))) ** 2;
      for (const [term, count] of vectors[index]) {
        const idf = Math.log(1 + chunks.length / (1 + frequencies.get(term)));
        const weight = (1 + Math.log(count)) * idf;
        length += weight ** 2;
        if (query.has(term)) dot += weight * idf;
      }
      return { ...chunk, score: dot / (Math.sqrt(length * queryLength) || 1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((chunk, index) => ({
      id: `document-${index}`,
      title: 'Your document',
      text: chunk.text,
      kind: 'document',
      url: null,
    }));
}

export async function judgeEvidence(claimText, sources, provider = llm) {
  if (!sources.length)
    return {
      verdict: 'not_enough',
      reason: 'No proof found in the available sources.',
      evidenceSnippet: '',
      sourceTitle: '',
      sourceUrl: null,
      sourceKind: 'none',
    };
  const output = await provider.generateJson({
    system: evidenceInstruction,
    prompt: evidencePrompt(
      claimText,
      sources.map(({ id, title, text }) => ({ id, title, text })),
    ),
    schema,
    model: config.GEMINI_JUDGE_MODEL,
  });
  const parsed = validator.safeParse(output);
  if (!parsed.success)
    throw new AppError(
      'The evidence response could not be read. This statement could not be verified.',
      502,
      'INVALID_EVIDENCE',
    );
  const result = parsed.data;
  const source = sources.find((item) => item.id === result.sourceId);
  const matched = Boolean(
    source && result.exactQuote.trim() && source.text.includes(result.exactQuote),
  );
  if (result.verdict !== 'not_enough' && !matched)
    return {
      verdict: 'not_enough',
      reason:
        'The cited words could not be matched to a source, so this statement could not be verified.',
      evidenceSnippet: '',
      sourceTitle: '',
      sourceUrl: null,
      sourceKind: sources[0].kind,
    };
  return {
    verdict: result.verdict,
    reason: result.reason,
    evidenceSnippet: matched ? result.exactQuote : '',
    sourceTitle: matched ? source.title : '',
    sourceUrl: matched ? source.url : null,
    sourceKind: matched ? source.kind : sources[0].kind,
  };
}

export const sourceTrust = (verdict) =>
  verdict === 'supported' ? 'High' : verdict === 'contradicted' ? 'Low' : 'Medium';

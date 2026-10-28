import { z } from 'zod';
import { config } from './config.js';
import { llm } from './llm.js';
import {
  evidenceInstruction,
  evidencePrompt,
  abstentionInstruction,
  abstentionPrompt,
} from './prompts.js';
import { verifyCalculation } from './calculation.js';
import { AppError } from './errors.js';

const citationSchema = {
  type: 'object',
  properties: { sourceId: { type: 'string' }, exactQuote: { type: 'string' } },
  required: ['sourceId', 'exactQuote'],
  additionalProperties: false,
};
const calculationSchema = {
  type: ['object', 'null'],
  properties: {
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
          sourceId: { type: 'string' },
          exactQuote: { type: 'string' },
        },
        required: ['name', 'value', 'sourceId', 'exactQuote'],
        additionalProperties: false,
      },
    },
    expression: { type: 'string' },
    claimedValue: { type: 'number' },
    precision: { type: 'integer', minimum: 0, maximum: 8 },
  },
  required: ['inputs', 'expression', 'claimedValue', 'precision'],
  additionalProperties: false,
};
const schema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['supported', 'contradicted', 'not_enough'] },
    reason: { type: 'string' },
    sourceId: { type: 'string' },
    exactQuote: { type: 'string' },
    assessmentType: { type: 'string', enum: ['direct', 'reasoned', 'calculation', 'none'] },
    citations: { type: 'array', maxItems: 8, items: citationSchema },
    calculation: calculationSchema,
  },
  required: [
    'verdict',
    'reason',
    'sourceId',
    'exactQuote',
    'assessmentType',
    'citations',
    'calculation',
  ],
  additionalProperties: false,
};
const validator = z
  .object({
    verdict: z.enum(['supported', 'contradicted', 'not_enough']),
    reason: z.string().min(1).max(600),
    sourceId: z.string().max(200),
    exactQuote: z.string().max(4000),
    assessmentType: z.enum(['direct', 'reasoned', 'calculation', 'none']).default('direct'),
    citations: z
      .array(
        z
          .object({ sourceId: z.string().max(200), exactQuote: z.string().min(1).max(4000) })
          .strict(),
      )
      .max(8)
      .default([]),
    calculation: z
      .object({
        inputs: z
          .array(
            z
              .object({
                name: z.string().regex(/^[a-z]$/),
                value: z.number().finite(),
                sourceId: z.string().max(200),
                exactQuote: z.string().min(1).max(4000),
              })
              .strict(),
          )
          .min(1)
          .max(8),
        expression: z.string().min(1).max(200),
        claimedValue: z.number().finite(),
        precision: z.number().int().min(0).max(8),
      })
      .strict()
      .nullable()
      .default(null),
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

const noProof = (reason, kind = 'none', assessmentType = 'none') => ({
  verdict: 'not_enough',
  reason,
  evidenceSnippet: '',
  sourceTitle: '',
  sourceUrl: null,
  sourceKind: kind,
  assessmentType,
  citations: [],
  calculation: null,
});

async function judgeAbstention(claimText, provider, context) {
  if (!context.documentText?.trim() || !context.question?.trim())
    return noProof(
      'Add the original question and source document to assess whether declining to answer is appropriate.',
      'document',
      'abstention',
    );
  const output = await provider.generateJson({
    system: abstentionInstruction,
    prompt: abstentionPrompt(claimText, context.question, context.documentText),
    model: context.judgeModel || config.GEMINI_JUDGE_MODEL,
    schema: {
      type: 'object',
      properties: {
        answerable: { type: 'boolean' },
        reason: { type: 'string' },
        exactQuote: { type: 'string' },
      },
      required: ['answerable', 'reason', 'exactQuote'],
      additionalProperties: false,
    },
  });
  const parsed = z
    .object({
      answerable: z.boolean(),
      reason: z.string().min(1).max(600),
      exactQuote: z.string().max(4000),
    })
    .strict()
    .safeParse(output);
  if (!parsed.success)
    throw new AppError(
      'The source answerability check could not be read.',
      502,
      'INVALID_EVIDENCE',
    );
  const result = parsed.data;
  if (
    result.answerable &&
    (!result.exactQuote.trim() || !context.documentText.includes(result.exactQuote))
  )
    return noProof(
      'The passage supporting an answer could not be verified, so the abstention needs a closer look.',
      'document',
      'abstention',
    );
  return {
    verdict: result.answerable ? 'contradicted' : 'supported',
    reason: result.reason,
    assessmentType: 'abstention',
    reviewScope: 'full_document',
    evidenceSnippet: result.answerable ? result.exactQuote : '',
    sourceTitle: context.sourceKind === 'link' ? 'Your linked source' : 'Your document',
    sourceUrl: context.sourceUrl || null,
    sourceKind: context.sourceKind || 'document',
    calculation: null,
    citations: result.answerable ? [{ sourceId: 'document', exactQuote: result.exactQuote }] : [],
  };
}

async function judgeEvidenceOnce(claimText, sources, provider = llm, context = {}) {
  if (context.claimKind === 'abstention') return judgeAbstention(claimText, provider, context);
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
      context.question || '',
      context,
    ),
    schema,
    model: context.judgeModel || config.GEMINI_JUDGE_MODEL,
  });
  const parsed = validator.safeParse(output);
  if (!parsed.success) {
    const error = new AppError(
      'The evidence response could not be read. This statement could not be verified.',
      502,
      'INVALID_EVIDENCE',
    );
    error.validationFields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw error;
  }
  const result = parsed.data;
  const citations = result.citations.length
    ? result.citations
    : result.exactQuote.trim()
      ? [{ sourceId: result.sourceId, exactQuote: result.exactQuote }]
      : [];
  if (
    citations.some(
      (citation) =>
        !sources.some(
          (source) =>
            source.id === citation.sourceId &&
            source.text.includes(citation.exactQuote) &&
            citation.exactQuote.trim(),
        ),
    )
  )
    return noProof(
      'A cited premise could not be matched to a source, so this reasoning could not be verified.',
      sources[0].kind,
      result.assessmentType,
    );
  if (result.assessmentType === 'calculation' || result.calculation) {
    if (!result.calculation)
      return noProof(
        'The calculation did not include verifiable source inputs.',
        sources[0].kind,
        'calculation',
      );
    try {
      const calculation = verifyCalculation(
        result.calculation,
        context.originalText || claimText,
        sources,
      );
      const first = calculation.inputs[0],
        source = sources.find((item) => item.id === first.sourceId);
      const verdict =
        result.verdict === 'not_enough'
          ? 'not_enough'
          : calculation.correct
            ? result.verdict
            : 'contradicted';
      return {
        verdict,
        reason:
          result.verdict === 'not_enough' ||
          (calculation.correct && result.verdict === 'contradicted')
            ? result.reason
            : calculation.correct
              ? `The arithmetic agrees with the answer. ${result.reason}`
              : `Using the cited source values, the arithmetic gives ${calculation.roundedValue}, while the answer states ${calculation.claimedValue}.`,
        assessmentType: 'calculation',
        calculation,
        citations: calculation.inputs.map(({ sourceId, exactQuote }) => ({ sourceId, exactQuote })),
        evidenceSnippet: first.exactQuote,
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceKind: source.kind,
      };
    } catch {
      return noProof(
        'The calculation could not be verified from the cited numbers and a supported arithmetic expression.',
        sources[0].kind,
        'calculation',
      );
    }
  }
  if (result.assessmentType === 'reasoned' && !citations.length)
    return noProof('The deduction did not include verifiable source premises.', sources[0].kind);
  const primary = citations[0] || { sourceId: result.sourceId, exactQuote: result.exactQuote };
  const source = sources.find((item) => item.id === primary.sourceId);
  const matched = Boolean(
    source && primary.exactQuote.trim() && source.text.includes(primary.exactQuote),
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
    evidenceSnippet: matched ? primary.exactQuote : '',
    sourceTitle: matched ? source.title : '',
    sourceUrl: matched ? source.url : null,
    sourceKind: matched ? source.kind : sources[0].kind,
    assessmentType: result.assessmentType,
    citations,
    calculation: null,
  };
}

// Network failures are retried by the provider adapter. A malformed/unfinished
// structured judgment gets one fresh attempt, without relaxing citation checks.
export async function judgeEvidence(claimText, sources, provider = llm, context = {}) {
  let model = config.GEMINI_JUDGE_MODEL;
  const fallback = config.GEMINI_JUDGE_FALLBACK_MODEL || config.GEMINI_REPEAT_MODEL;
  let usedFallback = false,
    repairs = 0;
  for (;;) {
    try {
      const result = await judgeEvidenceOnce(claimText, sources, provider, {
        ...context,
        judgeModel: model,
      });
      return {
        ...result,
        judgeModel: model,
        ...(usedFallback
          ? {
              warnings: [
                'The primary evidence model was unavailable. A fallback model completed this assessment using the same source checks.',
              ],
            }
          : {}),
      };
    } catch (error) {
      if (
        !usedFallback &&
        fallback &&
        fallback !== model &&
        ['GEMINI_RATE_LIMIT', 'GEMINI_UNAVAILABLE', 'GEMINI_CONNECTION', 'GEMINI_MODEL'].includes(
          error.code,
        )
      ) {
        model = fallback;
        usedFallback = true;
        continue;
      }
      if (
        repairs++ === 0 &&
        ['INVALID_EVIDENCE', 'INVALID_LLM_JSON', 'INCOMPLETE_LLM_OUTPUT'].includes(error.code)
      )
        continue;
      throw error;
    }
  }
}

export const sourceTrust = (verdict) =>
  verdict === 'supported' ? 'High' : verdict === 'contradicted' ? 'Low' : 'Medium';

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';
import { llm } from './llm.js';
import { extractionInstruction, extractionPrompt } from './prompts.js';

export const extractionSchema = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          exactQuote: { type: 'string' },
          kind: { type: 'string', enum: ['factual', 'abstention'] },
          statement: { type: 'string' },
        },
        required: ['exactQuote', 'kind', 'statement'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
};

const resultSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            kind: z.enum(['factual', 'abstention']).default('factual'),
            statement: z.string().trim().min(1).max(2000).optional(),
            exactQuote: z
              .string()
              .min(1)
              .max(50000)
              .refine((value) => value.trim().length > 0),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export function locateClaims(answerText, output, maxClaims = config.MAX_CLAIMS) {
  const parsed = resultSchema.safeParse(output);
  if (!parsed.success || parsed.data.claims.length > maxClaims) {
    throw new AppError(
      'Gemini returned an invalid list of statements. Please try again.',
      502,
      'INVALID_CLAIMS',
    );
  }
  let cursor = 0;
  return parsed.data.claims.map(({ exactQuote, kind, statement }) => {
    // Locate exact quotes ourselves. Model-generated character counts are unreliable,
    // particularly for emoji. JavaScript indices match React's string slicing.
    const startIndex = answerText.indexOf(exactQuote, cursor);
    if (startIndex === -1) {
      throw new AppError(
        'Some extracted statements did not match the original answer. Please try again.',
        502,
        'CLAIM_POSITION_MISMATCH',
      );
    }
    const endIndex = startIndex + exactQuote.length;
    cursor = endIndex;
    return {
      id: randomUUID(),
      claimText: exactQuote,
      verificationText: statement || exactQuote,
      kind,
      startIndex,
      endIndex,
      status: 'extracted',
      trustLevel: null,
    };
  });
}

export async function extractClaims(input, provider = llm) {
  const output = await provider.generateJson({
    system: extractionInstruction,
    prompt: extractionPrompt({ ...input, maxClaims: config.MAX_CLAIMS }),
    schema: {
      ...extractionSchema,
      properties: {
        claims: { ...extractionSchema.properties.claims, maxItems: config.MAX_CLAIMS },
      },
    },
  });
  return locateClaims(input.answerText, output);
}

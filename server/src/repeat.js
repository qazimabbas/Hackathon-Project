import { z } from 'zod';
import { llm } from './llm.js';
import { config } from './config.js';
import { mapConcurrent } from './concurrency.js';
import {
  questionInstruction,
  questionPrompt,
  repeatInstruction,
  repeatPrompt,
  agreementInstruction,
  agreementPrompt,
} from './prompts.js';
import { AppError } from './errors.js';

const textSchema = (key) => ({
  type: 'object',
  properties: { [key]: { type: 'string' } },
  required: [key],
  additionalProperties: false,
});
const matchesSchema = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          matches: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            items: { type: ['boolean', 'null'] },
          },
        },
        required: ['id', 'matches'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
};
const matchesValidator = z
  .object({
    claims: z
      .array(
        z.object({ id: z.string(), matches: z.array(z.boolean().nullable()).length(5) }).strict(),
      )
      .max(10),
  })
  .strict();

export async function inferQuestion(answerText, provider = llm) {
  const output = await provider.generateJson({
    system: questionInstruction,
    prompt: questionPrompt(answerText),
    schema: textSchema('question'),
    model: config.GEMINI_REPEAT_MODEL,
  });
  const parsed = z
    .object({ question: z.string().trim().min(5).max(config.MAX_QUESTION_CHARS) })
    .strict()
    .safeParse(output);
  if (!parsed.success)
    throw new AppError(
      'A question could not be inferred. Add the original question and check again.',
      502,
      'QUESTION_INFERENCE',
    );
  return parsed.data.question;
}

export async function repeatCheck(question, claims, provider = llm) {
  if (!claims.length) return { results: {}, answers: [] };
  const answers = await mapConcurrent([0, 1, 2, 3, 4], 2, async () => {
    try {
      const result = await provider.generateJson({
        system: repeatInstruction,
        prompt: repeatPrompt(question),
        schema: textSchema('answer'),
        model: config.GEMINI_REPEAT_MODEL,
        temperature: 0.9,
      });
      return z
        .object({ answer: z.string().trim().min(1).max(5000) })
        .strict()
        .parse(result).answer;
    } catch {
      return null;
    }
  });
  if (!answers.some(Boolean))
    return {
      answers,
      results: Object.fromEntries(
        claims.map((claim) => [
          claim.id,
          { matches: [null, null, null, null, null], hits: 0, completed: 0 },
        ]),
      ),
    };
  const output = await provider.generateJson({
    system: agreementInstruction,
    prompt: agreementPrompt(claims, answers),
    schema: matchesSchema,
    model: config.GEMINI_REPEAT_MODEL,
  });
  const parsed = matchesValidator.safeParse(output);
  if (
    !parsed.success ||
    parsed.data.claims.length !== claims.length ||
    new Set(parsed.data.claims.map((claim) => claim.id)).size !== claims.length ||
    !claims.every((claim) => parsed.data.claims.some((item) => item.id === claim.id))
  )
    throw new AppError(
      'The repeated answers could not be compared reliably.',
      502,
      'INVALID_AGREEMENT',
    );
  return {
    answers,
    results: Object.fromEntries(
      parsed.data.claims.map((claim) => {
        const matches = claim.matches.map((hit, index) => (answers[index] === null ? null : hit));
        return [
          claim.id,
          {
            matches,
            hits: matches.filter((hit) => hit === true).length,
            completed: matches.filter((hit) => hit !== null).length,
          },
        ];
      }),
    ),
  };
}

export function combineTrust(sourceResult, repeatResult) {
  if (sourceResult?.verdict === 'contradicted') return 'Low';
  if (sourceResult?.verdict === 'supported')
    return repeatResult && repeatResult.completed >= 3 && repeatResult.hits >= 3
      ? 'High'
      : 'Medium';
  // Repeated assertions never establish truth without evidence.
  if (!repeatResult || repeatResult.completed < 3) return 'Medium';
  return repeatResult.hits >= 3 ? 'Medium' : 'Low';
}

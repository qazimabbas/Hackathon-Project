import { z } from 'zod';
import { llm } from './llm.js';
import { config } from './config.js';
import { mapConcurrent } from './concurrency.js';
import {
  questionInstruction,
  questionPrompt,
  repeatInstruction,
  repeatPrompt,
  documentRepeatInstruction,
  documentRepeatPrompt,
  agreementInstruction,
  agreementPrompt,
} from './prompts.js';
import { AppError } from './errors.js';
import { reviewAgreement } from './agreementReview.js';

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
          reasons: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            items: { type: 'string' },
          },
        },
        required: ['id', 'matches', 'reasons'],
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
        z
          .object({
            id: z.string(),
            matches: z.array(z.boolean().nullable()).length(5),
            reasons: z.array(z.string().trim().min(1).max(600)).length(5),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

function safeFailure(error, fallback = 'AGREEMENT_UNAVAILABLE') {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : {
        code: fallback,
        message: 'The Gemini agreement service could not complete this step. Try a new check.',
      };
}

function resultFrom(comparisons, basis) {
  const matches = comparisons.map(({ status }) =>
    status === 'agreed' ? true : status === 'disagreed' ? false : null,
  );
  return {
    matches,
    hits: matches.filter((hit) => hit === true).length,
    completed: matches.filter((hit) => hit !== null).length,
    basis,
    generated: comparisons.filter((item) => item.answer !== null).length,
    generationFailed: comparisons.filter((item) => item.status === 'generation_failed').length,
    unaddressed: comparisons.filter((item) =>
      ['not_addressed', 'needs_review'].includes(item.primaryStatus || item.status),
    ).length,
    comparisonFailed: comparisons.filter(
      (item) => (item.primaryStatus || item.status) === 'comparison_failed',
    ).length,
    unavailable: comparisons.filter((item) => item.status === 'unavailable').length,
    comparisons,
  };
}

export function unavailableAgreement(claims, basis, error) {
  const failure = safeFailure(error);
  return {
    answers: [],
    results: Object.fromEntries(
      claims.map(({ id }) => [
        id,
        {
          ...resultFrom(
            Array.from({ length: 5 }, () => ({
              status: 'unavailable',
              answer: null,
              reason: failure.message,
              errorCode: failure.code,
            })),
            basis,
          ),
          generated: null,
        },
      ]),
    ),
  };
}

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

export async function repeatCheck(
  question,
  claims,
  provider = llm,
  { documentText = '', basis: sourceBasis = 'document' } = {},
) {
  if (!claims.length) return { results: {}, answers: [] };
  const basis = documentText.trim() ? sourceBasis : 'question';
  const generations = await mapConcurrent([0, 1, 2, 3, 4], 2, async () => {
    try {
      const result = await provider.generateJson({
        system: basis !== 'question' ? documentRepeatInstruction : repeatInstruction,
        prompt:
          basis !== 'question'
            ? documentRepeatPrompt(question, documentText)
            : repeatPrompt(question),
        schema: textSchema('answer'),
        model: config.GEMINI_REPEAT_MODEL,
        temperature: 0.9,
      });
      const parsed = z
        .object({ answer: z.string().trim().min(1).max(5000) })
        .strict()
        .safeParse(result);
      if (!parsed.success)
        throw new AppError(
          'Gemini returned a fresh answer in an unreadable format.',
          502,
          'INVALID_FRESH_ANSWER',
        );
      return { answer: parsed.data.answer };
    } catch (error) {
      return { answer: null, error: safeFailure(error, 'GENERATION_UNAVAILABLE') };
    }
  });
  const answers = generations.map(({ answer }) => answer);
  const failedGeneration = (index) => ({
    status: 'generation_failed',
    answer: null,
    reason: generations[index].error.message,
    errorCode: generations[index].error.code,
  });
  if (!answers.some(Boolean))
    return {
      answers,
      results: Object.fromEntries(
        claims.map((claim) => [
          claim.id,
          resultFrom(
            answers.map((_answer, index) => failedGeneration(index)),
            basis,
          ),
        ]),
      ),
    };
  let compared;
  let comparisonError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const output = await provider.generateJson({
        system: agreementInstruction,
        prompt: agreementPrompt(claims, answers, question),
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
          'The generated answers could not be compared reliably.',
          502,
          'INVALID_AGREEMENT',
        );
      compared = parsed.data.claims;
      break;
    } catch (error) {
      comparisonError = safeFailure(error);
      // Repair only malformed comparisons, retaining the five original answers.
      if (
        !['INVALID_AGREEMENT', 'INVALID_LLM_JSON', 'INCOMPLETE_LLM_OUTPUT'].includes(
          comparisonError.code,
        )
      )
        break;
    }
  }
  const results = Object.fromEntries(
    claims.map(({ id }) => {
      const claim = compared?.find((item) => item.id === id);
      return [
        id,
        resultFrom(
          answers.map((answer, index) => {
            if (answer === null) return failedGeneration(index);
            if (!claim)
              return {
                status: 'comparison_failed',
                answer,
                reason: comparisonError.message,
                errorCode: comparisonError.code,
              };
            const hit = claim.matches[index];
            return {
              status: hit === true ? 'agreed' : hit === false ? 'disagreed' : 'not_addressed',
              answer,
              reason: claim.reasons[index],
            };
          }),
          basis,
        ),
      ];
    }),
  );
  await reviewAgreement(question, claims, answers, results, provider);
  return {
    answers,
    results: Object.fromEntries(
      Object.entries(results).map(([id, result]) => [id, resultFrom(result.comparisons, basis)]),
    ),
  };
}

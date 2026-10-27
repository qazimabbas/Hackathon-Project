import { setTimeout as delay } from 'node:timers/promises';
import { config, hasSecret } from './config.js';
import { AppError } from './errors.js';

const retryableStatuses = new Set([429, 500, 502, 503, 504]);

function providerError(status) {
  if (status === 400 || status === 401 || status === 403) {
    return new AppError(
      'Gemini rejected this request. Check GEMINI_API_KEY, API access, and model settings in the project-root .env.',
      502,
      'GEMINI_ACCESS',
    );
  }
  if (status === 404)
    return new AppError(
      'The selected Gemini model is unavailable. Update GEMINI_EXTRACT_MODEL in .env.',
      502,
      'GEMINI_MODEL',
    );
  if (status === 429)
    return new AppError(
      'Gemini is busy or its usage limit was reached. Please wait, or check your Gemini quota.',
      503,
      'GEMINI_RATE_LIMIT',
    );
  return new AppError(
    'Gemini is temporarily unavailable. Please try again.',
    502,
    'GEMINI_UNAVAILABLE',
  );
}

// This adapter is the only module that knows the provider's HTTP format.
// Add another adapter here and select it with LLM_PROVIDER to switch providers.
export function createLlm({ settings = config, fetchImpl = fetch, sleep = delay } = {}) {
  async function generateJson({
    system,
    prompt,
    schema,
    model = settings.GEMINI_EXTRACT_MODEL,
    temperature = 0,
  }) {
    // Provider-specific alternatives can be implemented here without editing routes.
    if (settings.LLM_PROVIDER && settings.LLM_PROVIDER !== 'gemini')
      throw new AppError(
        'Add the selected provider adapter in server/src/llm.js, or set LLM_PROVIDER=gemini in .env.',
        503,
        'PROVIDER_NOT_IMPLEMENTED',
      );
    if (!hasSecret(settings.GEMINI_API_KEY)) {
      throw new AppError(
        'Add GEMINI_API_KEY to the project-root .env, then restart the server. You can still try the saved example.',
        503,
        'MISSING_GEMINI_KEY',
      );
    }
    for (let attempt = 0; attempt <= settings.LLM_MAX_RETRIES; attempt++) {
      let response;
      try {
        response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            // Never put the key into a URL, logs, or an error message.
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': settings.GEMINI_API_KEY,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature,
                maxOutputTokens: 4096,
                responseMimeType: 'application/json',
                responseJsonSchema: schema,
                ...(model.startsWith('gemini-3')
                  ? { thinkingConfig: { thinkingLevel: 'low' } }
                  : {}),
              },
            }),
            signal: AbortSignal.timeout(settings.LLM_TIMEOUT_MS),
          },
        );
      } catch {
        if (attempt < settings.LLM_MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new AppError(
          'Could not reach Gemini in time. Check your internet connection and try again.',
          504,
          'GEMINI_CONNECTION',
        );
      }
      if (!response.ok) {
        // Discard upstream error bodies, which may include credentials or user text.
        await response.body?.cancel();
        if (retryableStatuses.has(response.status) && attempt < settings.LLM_MAX_RETRIES) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const wait =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 10000)
              : 1000 * 2 ** attempt;
          await sleep(wait);
          continue;
        }
        throw providerError(response.status);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new AppError(
          'Gemini returned an unreadable response. Please try again.',
          502,
          'INVALID_LLM_JSON',
        );
      }
      const candidate = body.candidates?.[0];
      if (!candidate || candidate.finishReason !== 'STOP') {
        throw new AppError(
          'Gemini could not finish reading this answer. Try a shorter passage or different text.',
          502,
          'INCOMPLETE_LLM_OUTPUT',
        );
      }
      const output = candidate.content?.parts
        ?.filter((part) => !part.thought)
        .map((part) => part.text ?? '')
        .join('');
      try {
        return JSON.parse(output);
      } catch {
        throw new AppError(
          'Gemini returned an unreadable list of statements. Please try again.',
          502,
          'INVALID_LLM_JSON',
        );
      }
    }
  }
  return { generateJson };
}
export const llm = createLlm();

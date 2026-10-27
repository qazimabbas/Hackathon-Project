import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
dotenv.config({ path: new URL('../../.env', import.meta.url), quiet: true });

const integer = (fallback, min, max) => z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  LLM_PROVIDER: z.string().trim().min(1).default('gemini'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_EXTRACT_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .default('gemini-3.5-flash-lite'),
  GEMINI_JUDGE_MODEL: z.string().default('gemini-3.6-flash'),
  GEMINI_REPEAT_MODEL: z.string().default('gemini-3.5-flash-lite'),
  MONGODB_URI: z.string().default(''),
  MONGODB_DNS_SERVERS: z.string().default(''),
  TAVILY_API_KEY: z.string().default(''),
  PORT: integer(3001, 1, 65535),
  CLIENT_PORT: integer(5173, 1, 65535),
  CLIENT_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  MAX_ANSWER_CHARS: integer(12000, 100, 50000),
  MAX_DOCUMENT_CHARS: integer(60000, 100, 200000),
  MAX_QUESTION_CHARS: integer(2000, 100, 10000),
  MAX_CLAIMS: integer(10, 1, 10),
  CLAIM_CONCURRENCY: integer(3, 1, 5),
  LLM_TIMEOUT_MS: integer(90000, 1000, 120000),
  LLM_MAX_RETRIES: integer(2, 0, 3),
  RATE_LIMIT_MAX: integer(10, 1, 100),
  RATE_LIMIT_WINDOW_MS: integer(900000, 1000, 3600000),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Only print field names. Validation details can include secret input values.
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))];
  throw new Error(`Check these settings in the project-root .env: ${fields.join(', ')}`);
}
export const config = Object.freeze(parsed.data);
export const hasSecret = (value) => Boolean(value && !value.includes('REPLACE_'));

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config, hasSecret, projectRoot } from './config.js';
import { extractClaims } from './claims.js';
import { example } from '../../shared/example.js';
import { AppError } from './errors.js';
import { judgeEvidence } from './evidence.js';
import { searchEvidence, extractLinkedSource, publicSourceUrl } from './sources.js';
import { createPipeline } from './pipeline.js';

const inputSchema = z
  .object({
    answerText: z
      .string()
      .min(1)
      .max(config.MAX_ANSWER_CHARS)
      .refine((value) => value.trim().length > 0),
    question: z.string().max(config.MAX_QUESTION_CHARS).default(''),
    documentText: z.string().max(config.MAX_DOCUMENT_CHARS).default(''),
    sourceUrl: z
      .string()
      .trim()
      .max(2048)
      .default('')
      .refine((value) => !value || Boolean(publicSourceUrl(value)))
      .transform((value) => (value ? publicSourceUrl(value) : '')),
  })
  .strict();

export function createApp({
  extractor = extractClaims,
  evidenceJudge = judgeEvidence,
  searcher = searchEvidence,
  sourceLoader = extractLinkedSource,
  repository = null,
  checkSources = true,
  rateLimitMax = config.RATE_LIMIT_MAX,
} = {}) {
  const app = express();
  const pipeline = createPipeline({
    extractor,
    judge: evidenceJudge,
    search: searcher,
    loadSource: sourceLoader,
    checkSources,
    ...(repository
      ? {
          onComplete: (check) => repository.save(check),
          findCached: (input) => repository.findCached(input).catch(() => null),
        }
      : {}),
  });
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: '512kb' }));
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_request, response) =>
    response.json({
      name: 'Hallucination Visualizer',
      phase: 7,
      provider: config.LLM_PROVIDER,
      llmConfigured: hasSecret(config.GEMINI_API_KEY),
      databaseConfigured: hasSecret(config.MONGODB_URI),
      limits: {
        answer: config.MAX_ANSWER_CHARS,
        question: config.MAX_QUESTION_CHARS,
        document: config.MAX_DOCUMENT_CHARS,
        claims: config.MAX_CLAIMS,
      },
    }),
  );
  app.get('/api/example', (_request, response) => response.json({ check: example }));

  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({
        error: {
          code: 'CHECK_LIMIT',
          message:
            'You have reached the check limit for now. Please wait before trying again. The saved example is still available.',
        },
      }),
  });
  app.post('/api/checks', limiter, async (request, response) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success)
      throw new AppError(
        `Enter an answer of up to ${config.MAX_ANSWER_CHARS.toLocaleString()} characters, a question of up to ${config.MAX_QUESTION_CHARS.toLocaleString()}, a document of up to ${config.MAX_DOCUMENT_CHARS.toLocaleString()}, and an optional public http(s) source URL.`,
        400,
        'INVALID_INPUT',
      );
    const check = await pipeline.start(parsed.data);
    response.status(check.cached ? 200 : 202).json({ id: check.id, check });
  });
  app.get('/api/checks', async (request, response) => {
    if (!repository)
      throw new AppError('The history database is not configured.', 503, 'DATABASE_UNAVAILABLE');
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .safeParse(request.query.page || 1);
    if (!page.success) throw new AppError('Choose a valid history page.', 400, 'INVALID_PAGE');
    response.json(await repository.history(page.data));
  });
  app.get('/api/stats', async (_request, response) => {
    if (!repository)
      throw new AppError('The history database is not configured.', 503, 'DATABASE_UNAVAILABLE');
    response.json(await repository.stats());
  });
  app.get('/api/checks/:id', async (request, response) => {
    const check = pipeline.get(request.params.id) || (await repository?.get(request.params.id));
    if (!check) throw new AppError('This check could not be found.', 404, 'CHECK_NOT_FOUND');
    response.json({ check });
  });
  app.get('/api/checks/:id/stream', async (request, response) => {
    const check = pipeline.get(request.params.id) || (await repository?.get(request.params.id));
    if (!check) throw new AppError('This check could not be found.', 404, 'CHECK_NOT_FOUND');
    response.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const send = (snapshot) => {
      if (response.writableEnded || response.destroyed) return;
      response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      if (['complete', 'failed'].includes(snapshot.status)) response.end();
    };
    const unsubscribe = pipeline.subscribe(check.id, send);
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(': keep-alive\n\n');
    }, 15000);
    response.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    send(check);
  });
  app.post('/api/checks/:id/share', limiter, async (request, response) => {
    if (!repository)
      throw new AppError(
        'Save this check to the database before sharing.',
        503,
        'DATABASE_UNAVAILABLE',
      );
    const token = await repository.share(request.params.id);
    response.json({ path: `/#/shared/${token}` });
  });
  app.get('/api/shared/:token', async (request, response) => {
    if (!repository)
      throw new AppError('The shared result could not be loaded.', 503, 'DATABASE_UNAVAILABLE');
    const check = await repository.shared(request.params.token);
    if (!check) throw new AppError('This shared link could not be found.', 404, 'SHARE_NOT_FOUND');
    response.json({ check });
  });
  app.use('/api', (_request, _response, next) =>
    next(new AppError('This API route does not exist.', 404, 'NOT_FOUND')),
  );

  const clientDist = path.join(projectRoot, 'client', 'dist');
  if (config.NODE_ENV === 'production' && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_request, response) =>
      response.sendFile(path.join(clientDist, 'index.html')),
    );
  }
  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.too.large')
      return response.status(413).json({
        error: {
          code: 'INPUT_TOO_LARGE',
          message: 'This text is too large. Please paste a shorter answer or document.',
        },
      });
    if (error.type === 'entity.parse.failed')
      return response.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'The request could not be read. Please try again.',
        },
      });
    const known = error instanceof AppError;
    // Never send or log raw provider, database, or validation error objects.
    response.status(known ? error.status : 500).json({
      error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'Something went wrong. Please try again.',
      },
    });
  });
  return app;
}

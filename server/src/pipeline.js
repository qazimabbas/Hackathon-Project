import { randomUUID } from 'node:crypto';
import { extractClaims } from './claims.js';
import { documentSources, judgeEvidence } from './evidence.js';
import { searchEvidence } from './sources.js';
import { repeatCheck, inferQuestion, combineTrust } from './repeat.js';
import { mapConcurrent } from './concurrency.js';
import { config } from './config.js';
import { AppError } from './errors.js';

export function summarize(claims) {
  const summary = { total: claims.length, High: 0, Medium: 0, Low: 0, pending: 0, errors: 0 };
  for (const claim of claims) {
    if (claim.trustLevel) summary[claim.trustLevel]++;
    else summary.pending++;
    if (claim.status === 'error') summary.errors++;
  }
  return summary;
}

export function createPipeline({
  extractor = extractClaims,
  judge = judgeEvidence,
  search = searchEvidence,
  repeat = repeatCheck,
  infer = inferQuestion,
  checkSources = true,
  onComplete = async () => {},
  findCached = async () => null,
} = {}) {
  const jobs = new Map(),
    listeners = new Map();
  let active = 0;
  const snapshot = (job) => structuredClone(job);
  function emit(job) {
    job.overallSummary = summarize(job.claims);
    for (const listener of listeners.get(job.id) || []) listener(snapshot(job));
  }
  async function run(job) {
    try {
      job.status = 'extracting';
      emit(job);
      const claims = await extractor(job);
      job.claims = claims.map((claim) => ({ ...claim, status: 'pending' }));
      job.status = 'checking';
      emit(job);
      if (claims.length) {
        let questionUsed = job.question;
        if (!questionUsed.trim() && checkSources) {
          job.questionInferred = true;
          job.warnings.push(
            'Without the original question, the repeat check may be less accurate.',
          );
          try {
            questionUsed = await infer(job.answerText);
            job.inferredQuestion = questionUsed;
          } catch {
            job.warnings.push(
              'A question could not be inferred. Add the original question for a repeat check.',
            );
          }
          emit(job);
        }
        // One set of five answers is shared across all claims, keeping costs bounded.
        const repeated =
          checkSources && questionUsed
            ? repeat(questionUsed, claims).catch(() => ({ results: {}, answers: [] }))
            : Promise.resolve({ results: {}, answers: [] });
        await mapConcurrent(claims, config.CLAIM_CONCURRENCY, async (claim, index) => {
          let sourceResult = null,
            sourceError = false,
            warnings = [];
          if (checkSources) {
            try {
              const found = job.documentText.trim()
                ? { sources: documentSources(job.documentText, claim.claimText), warnings: [] }
                : await search(claim.claimText);
              warnings = found.warnings;
              sourceResult = await judge(claim.claimText, found.sources);
            } catch {
              sourceError = true;
              warnings.push('The evidence check could not finish for this statement.');
            }
          }
          const { results } = await repeated;
          const repeatResult = results[claim.id] || {
            matches: [null, null, null, null, null],
            hits: 0,
            completed: 0,
          };
          if (repeatResult.completed < 5)
            warnings.push(`${5 - repeatResult.completed} repeated answers could not be checked.`);
          job.claims[index] = {
            ...claim,
            status: sourceError ? 'error' : 'complete',
            sourceResult,
            repeatResult,
            repeatHits: repeatResult.hits,
            trustLevel: checkSources ? combineTrust(sourceResult, repeatResult) : null,
            reasonText:
              sourceResult?.reason ||
              (sourceError
                ? 'The evidence check could not finish. This statement needs a closer look.'
                : 'No proof found.'),
            warnings,
          };
          emit(job);
        });
      }
      job.status = 'complete';
      job.completedAt = new Date().toISOString();
      job.overallSummary = summarize(job.claims);
      try {
        await onComplete(snapshot(job));
        job.saved = true;
      } catch {
        job.saved = false;
        job.warnings.push(
          'This check could not be saved to history. Keep this page open and check the database connection.',
        );
      }
      emit(job);
    } catch (error) {
      job.status = 'failed';
      job.error = {
        code: error instanceof AppError ? error.code : 'CHECK_FAILED',
        message:
          error instanceof AppError
            ? error.message
            : 'This check could not finish. Please try again.',
      };
      emit(job);
    } finally {
      active--;
    }
  }
  async function start(input) {
    const cached = await findCached(input);
    if (cached) return { ...cached, cached: true };
    const inProgress = [...jobs.values()].find(
      (job) =>
        !['complete', 'failed'].includes(job.status) &&
        job.answerText === input.answerText &&
        job.question === input.question &&
        job.documentText === input.documentText,
    );
    if (inProgress) return snapshot(inProgress);
    if (active >= 2)
      throw new AppError(
        'Two checks are already running. Wait for one to finish before starting another.',
        503,
        'CHECKS_BUSY',
      );
    for (const [id, job] of jobs)
      if (
        ['complete', 'failed'].includes(job.status) &&
        Date.now() - Date.parse(job.createdAt) > 3600000 &&
        !listeners.get(id)?.size
      )
        jobs.delete(id);
    const job = {
      id: randomUUID(),
      ...input,
      mode: 'live',
      createdAt: new Date().toISOString(),
      status: 'queued',
      claims: [],
      warnings: [],
      questionInferred: false,
      overallSummary: summarize([]),
    };
    jobs.set(job.id, job);
    active++;
    setImmediate(() => void run(job));
    return snapshot(job);
  }
  function subscribe(id, callback) {
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(callback);
    return () => {
      const subscribers = listeners.get(id);
      subscribers?.delete(callback);
      if (!subscribers?.size) listeners.delete(id);
    };
  }
  return { start, get: (id) => (jobs.has(id) ? snapshot(jobs.get(id)) : null), subscribe };
}

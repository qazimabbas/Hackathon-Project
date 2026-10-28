import { randomUUID } from 'node:crypto';
import { extractClaims } from './claims.js';
import { documentSources, judgeEvidence, sourceTrust } from './evidence.js';
import { searchEvidence, extractLinkedSource } from './sources.js';
import { repeatCheck, inferQuestion } from './repeat.js';
import { mapConcurrent } from './concurrency.js';
import { config } from './config.js';
import { AppError } from './errors.js';

export function summarize(claims) {
  const summary = { total: claims.length, High: 0, Medium: 0, Low: 0, pending: 0, errors: 0 };
  for (const claim of claims) {
    if (claim.trustLevel) summary[claim.trustLevel]++;
    else if (claim.status !== 'error') summary.pending++;
    if (claim.status === 'error') summary.errors++;
  }
  return summary;
}

export function createPipeline({
  extractor = extractClaims,
  judge = judgeEvidence,
  search = searchEvidence,
  loadSource = extractLinkedSource,
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
      if (job.sourceUrl && checkSources) {
        job.status = 'loading_source';
        emit(job);
        job.linkedSource = await loadSource(job.sourceUrl);
        emit(job);
      }
      const referenceText = [job.documentText, job.linkedSource?.text]
        .filter((text) => text?.trim())
        .join('\n\n');
      const referenceKind = job.sourceUrl
        ? job.documentText.trim()
          ? 'reference'
          : 'link'
        : 'document';
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
            ? repeat(questionUsed, claims, undefined, {
                documentText: referenceText,
                basis: job.sourceUrl ? 'source' : 'document',
              }).catch(() => ({ results: {}, answers: [] }))
            : Promise.resolve({ results: {}, answers: [] });
        await mapConcurrent(claims, config.CLAIM_CONCURRENCY, async (claim, index) => {
          let sourceResult = null,
            sourceError = false,
            verificationError = null,
            warnings = [];
          if (checkSources) {
            try {
              const verificationText = claim.verificationText || claim.claimText;
              const query = `${job.question} ${verificationText}`;
              const found = referenceText.trim()
                ? {
                    sources: [
                      ...(job.documentText.trim() ? documentSources(job.documentText, query) : []),
                      ...(job.linkedSource
                        ? documentSources(job.linkedSource.text, query).map((source) => ({
                            ...source,
                            id: `link-${source.id}`,
                            kind: 'link',
                            title: job.linkedSource.title,
                            url: job.linkedSource.url,
                          }))
                        : []),
                    ],
                    warnings: [],
                  }
                : await search(query);
              warnings = found.warnings;
              sourceResult = await judge(verificationText, found.sources, undefined, {
                question: job.question,
                documentText: referenceText,
                claimKind: claim.kind,
                originalText: claim.claimText,
                answerText: job.answerText,
                sourceKind: referenceKind,
                sourceUrl: job.linkedSource?.url,
              });
              warnings.push(...(sourceResult.warnings || []));
            } catch (error) {
              sourceError = true;
              verificationError = {
                code: error instanceof AppError ? error.code : 'EVIDENCE_UNAVAILABLE',
                message:
                  error instanceof AppError
                    ? error.message
                    : 'The evidence service could not finish this check. Try checking again.',
              };
              warnings.push(
                `${verificationError.message} Fresh-answer agreement alone cannot verify the statement.`,
              );
            }
          }
          job.claims[index] = {
            ...claim,
            status: sourceError ? 'error' : 'complete',
            sourceResult,
            verificationError,
            trustLevel: checkSources && !sourceError ? sourceTrust(sourceResult?.verdict) : null,
            reasonText:
              sourceResult?.reason ||
              (sourceError
                ? `${verificationError.message} This is an unavailable evidence check, not a judgment against the wording.`
                : 'No proof found.'),
            warnings,
          };
          emit(job);
        });
        // Publish evidence ratings before waiting for supplementary Gemini agreement.
        const { results } = await repeated;
        for (const claim of job.claims) {
          claim.repeatResult = results[claim.id] || {
            matches: [null, null, null, null, null],
            hits: 0,
            completed: 0,
            basis: job.sourceUrl ? 'source' : job.documentText.trim() ? 'document' : 'question',
          };
          claim.repeatHits = claim.repeatResult.hits;
          if (claim.repeatResult.completed < 5)
            claim.warnings.push(
              `${5 - claim.repeatResult.completed} Gemini answers were unavailable or did not address this statement well enough to compare. This does not change the evidence-based trust label.`,
            );
        }
        emit(job);
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
    if (input.documentText?.trim() && input.sourceUrl?.trim())
      throw new AppError(
        'Choose either a source document or a source link for each check.',
        400,
        'SOURCE_CONFLICT',
      );
    // Linked pages can change independently of their URL. Always read them afresh.
    const cached = input.sourceUrl ? null : await findCached(input);
    if (cached) return { ...cached, cached: true };
    const inProgress = [...jobs.values()].find(
      (job) =>
        !['complete', 'failed'].includes(job.status) &&
        job.answerText === input.answerText &&
        job.question === input.question &&
        job.documentText === input.documentText &&
        job.sourceUrl === (input.sourceUrl || ''),
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
      sourceUrl: input.sourceUrl || '',
      mode: 'live',
      trustPolicy: 'evidence-only-v1',
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

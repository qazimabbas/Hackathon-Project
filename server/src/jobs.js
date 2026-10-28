import mongoose from 'mongoose';
import { getDatabase } from './db.js';
import { AppError } from './errors.js';
import { summarize } from './pipeline.js';

const terminal = (status) => ['complete', 'failed'].includes(status);
const jobSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  ownerId: { type: String, index: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  deadlineAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export function createJobStore({ modelProvider, now = () => Date.now() } = {}) {
  const model =
    modelProvider ||
    (async () => {
      const connection = await getDatabase();
      return connection.models.VerificationJob || connection.model('VerificationJob', jobSchema);
    });
  const safe =
    (operation) =>
    async (...args) => {
      try {
        return await operation(...args);
      } catch {
        throw new AppError(
          'Verification progress could not be stored in Atlas. Check the database connection and try again.',
          503,
          'JOB_STORAGE_UNAVAILABLE',
        );
      }
    };
  return {
    save: safe(async (snapshot) => {
      const Job = await model();
      const started = Date.parse(snapshot.createdAt);
      await Job.updateOne(
        { id: snapshot.id },
        {
          $set: {
            snapshot,
            ownerId: snapshot.ownerId,
            deadlineAt: new Date(started + 315000),
            expiresAt: new Date(started + 86400000),
          },
        },
        { upsert: true, runValidators: true },
      );
    }),
    get: safe(async (id, ownerId) => {
      const Job = await model();
      const record = await Job.findOne({ id, ...(ownerId ? { ownerId } : {}) }).lean();
      if (!record || new Date(record.expiresAt).getTime() <= now()) return null;
      const check = record.snapshot;
      if (!terminal(check.status) && new Date(record.deadlineAt).getTime() < now()) {
        check.status = 'failed';
        check.error = {
          code: 'CHECK_TIMEOUT',
          message:
            'This check exceeded the hosted runtime limit or its connection ended. Start a new check, or try a shorter answer.',
        };
        check.claims = check.claims.map((claim) =>
          claim.status === 'pending'
            ? {
                ...claim,
                status: 'error',
                trustLevel: null,
                reasonText: check.error.message,
                verificationError: check.error,
              }
            : claim,
        );
        check.overallSummary = summarize(check.claims);
      }
      return check;
    }),
  };
}

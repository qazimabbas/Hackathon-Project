import mongoose from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { getDatabase } from './db.js';
import { config, hasSecret } from './config.js';
import { AppError } from './errors.js';

const claimSchema = new mongoose.Schema(
  {
    id: String,
    claimText: String,
    startIndex: Number,
    endIndex: Number,
    status: String,
    trustLevel: { type: String, enum: ['High', 'Medium', 'Low', null] },
    reasonText: String,
    sourceResult: mongoose.Schema.Types.Mixed,
    repeatResult: mongoose.Schema.Types.Mixed,
    repeatHits: Number,
    warnings: [String],
  },
  { _id: false },
);
const checkSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  cacheKey: { type: String, required: true, index: true },
  answerText: { type: String, required: true },
  question: String,
  documentText: String,
  createdAt: { type: Date, required: true, index: true },
  completedAt: Date,
  status: { type: String, enum: ['complete'], required: true },
  mode: String,
  claims: [claimSchema],
  overallSummary: {
    total: Number,
    High: Number,
    Medium: Number,
    Low: Number,
    pending: Number,
    errors: Number,
  },
  warnings: [String],
  questionInferred: Boolean,
  inferredQuestion: String,
  saved: Boolean,
  shareToken: { type: String, unique: true, sparse: true },
});
export function cacheKey(input) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        answer: input.answerText,
        question: input.question || '',
        source: input.documentText || '',
        models: [
          config.GEMINI_EXTRACT_MODEL,
          config.GEMINI_JUDGE_MODEL,
          config.GEMINI_REPEAT_MODEL,
        ],
        web: hasSecret(config.TAVILY_API_KEY),
        claims: config.MAX_CLAIMS,
        version: 1,
      }),
    )
    .digest('hex');
}
const projection = '-_id -__v -cacheKey -shareToken';
const wrap =
  (operation) =>
  async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'The history database is unavailable. Check the Atlas connection and try again.',
        503,
        'DATABASE_UNAVAILABLE',
      );
    }
  };

export function createRepository({ modelProvider } = {}) {
  const model =
    modelProvider ||
    (async () => {
      const connection = await getDatabase();
      return connection.models.Check || connection.model('Check', checkSchema);
    });
  return {
    save: wrap(async (check) => {
      const Check = await model();
      await Check.updateOne(
        { id: check.id },
        { $set: { ...check, saved: true, cacheKey: cacheKey(check) } },
        { upsert: true, runValidators: true },
      );
    }),
    get: wrap(async (id) => {
      const Check = await model();
      return Check.findOne({ id }).select(projection).lean();
    }),
    findCached: wrap(async (input) => {
      const Check = await model();
      return Check.findOne({
        cacheKey: cacheKey(input),
        status: 'complete',
        'overallSummary.errors': 0,
        'overallSummary.total': { $gt: 0 },
        claims: { $not: { $elemMatch: { 'repeatResult.completed': { $lt: 5 } } } },
        createdAt: { $gte: new Date(Date.now() - 86400000) },
      })
        .sort({ createdAt: -1 })
        .select(projection)
        .lean();
    }),
    history: wrap(async (page = 1) => {
      const Check = await model();
      const [checks, total] = await Promise.all([
        Check.find()
          .sort({ createdAt: -1 })
          .skip((page - 1) * 20)
          .limit(20)
          .select(
            'id answerText question createdAt overallSummary claims.id claims.startIndex claims.endIndex claims.trustLevel -_id',
          )
          .lean(),
        Check.countDocuments(),
      ]);
      return { checks, total, page, pageSize: 20 };
    }),
    stats: wrap(async () => {
      const Check = await model();
      const [totals, trend] = await Promise.all([
        Check.aggregate([
          {
            $group: {
              _id: null,
              checks: { $sum: 1 },
              claims: { $sum: '$overallSummary.total' },
              High: { $sum: '$overallSummary.High' },
              Medium: { $sum: '$overallSummary.Medium' },
              Low: { $sum: '$overallSummary.Low' },
            },
          },
        ]),
        Check.aggregate([
          { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Karachi' },
              },
              checks: { $sum: 1 },
              claims: { $sum: '$overallSummary.total' },
              High: { $sum: '$overallSummary.High' },
              Medium: { $sum: '$overallSummary.Medium' },
              Low: { $sum: '$overallSummary.Low' },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: '$_id', checks: 1, claims: 1, High: 1, Medium: 1, Low: 1 } },
        ]),
      ]);
      const { _id: _ignored, ...summary } = totals[0] || {
        checks: 0,
        claims: 0,
        High: 0,
        Medium: 0,
        Low: 0,
      };
      // Include days with no checks so equal chart spacing really means equal time.
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const days = new Map(trend.map((day) => [day.date, day]));
      const filledTrend = Array.from({ length: 30 }, (_, index) => {
        const day = new Date(`${today}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() - 29 + index);
        const key = day.toISOString().slice(0, 10);
        return days.get(key) || { date: key, checks: 0, claims: 0, High: 0, Medium: 0, Low: 0 };
      });
      return { ...summary, trend: filledTrend, timezone: 'Asia/Karachi' };
    }),
    share: wrap(async (id) => {
      const Check = await model();
      const record = await Check.findOne({ id });
      if (!record)
        throw new AppError('This saved check could not be found.', 404, 'CHECK_NOT_FOUND');
      if (!record.shareToken) {
        record.shareToken = randomBytes(24).toString('hex');
        await record.save();
      }
      return record.shareToken;
    }),
    shared: wrap(async (token) => {
      if (!/^[a-f0-9]{48}$/.test(token)) return null;
      const Check = await model();
      const check = await Check.findOne({ shareToken: token })
        .select(`${projection} -documentText`)
        .lean();
      return check ? { ...check, readOnly: true } : null;
    }),
  };
}

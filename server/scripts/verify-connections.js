import { verifyDatabase } from '../src/db.js';
import { extractClaims } from '../src/claims.js';

// Makes one small real extraction request and one read-only Atlas ping.
const results = await Promise.allSettled([
  (async () => {
    const claims = await extractClaims({
      answerText: 'Apollo 11 landed on the Moon in July 1969.',
      question: 'When did Apollo 11 land on the Moon?',
    });
    if (claims.length !== 1) throw new Error('Unexpected extraction response.');
    return {
      ok: true,
      code: 'GEMINI_OK',
      message: 'Gemini extraction and exact text positions verified.',
    };
  })(),
  verifyDatabase(),
]);
let failed = false;
for (let index = 0; index < results.length; index++) {
  const result = results[index];
  const safe =
    result.status === 'fulfilled'
      ? result.value
      : {
          ok: false,
          code: result.reason.code ?? 'VERIFICATION_FAILED',
          message: result.reason.code
            ? result.reason.message
            : 'Connection verification failed. Check .env and network access.',
        };
  failed ||= !safe.ok;
  console.log(`${index === 0 ? 'Gemini' : 'MongoDB'}: ${JSON.stringify(safe)}`);
}
if (failed) process.exitCode = 1;

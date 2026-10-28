import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { extractClaims } from '../server/src/claims.js';
import { documentSources, judgeEvidence } from '../server/src/evidence.js';
import { createPipeline } from '../server/src/pipeline.js';
import { createRepository } from '../server/src/repository.js';
import { getDatabase } from '../server/src/db.js';

// Explicit real-service check. Uses Gemini/Tavily quota and saves one verified URL check.
const fixture = {
  question: 'How many Indians served in WWII, and how many died?',
  answerText:
    'Based on the provided document:\n\n* **Served:** More than 2.5 million Indian subcontienent citizens\n\n* **Died:** About 87,000',
  // A controlled reference defines the intended scope. This is a semantic test fixture.
  documentText:
    'This reference uses Indians to mean people from the Indian subcontinent who served in the British Indian Army during World War II. More than 2.5 million Indians served in World War II. About 87,000 died.',
};
const outputs = {};
let connection;
try {
  const claims = await extractClaims(fixture);
  assert.equal(claims.length, 2);
  const assessments = await Promise.all(
    claims.map(async (claim) => {
      assert.equal(fixture.answerText.slice(claim.startIndex, claim.endIndex), claim.claimText);
      assert.ok(claim.verificationText && claim.verificationText !== claim.claimText);
      const result = await judgeEvidence(
        claim.verificationText,
        documentSources(fixture.documentText, claim.verificationText),
        undefined,
        {
          question: fixture.question,
          originalText: claim.claimText,
          answerText: fixture.answerText,
          documentText: fixture.documentText,
        },
      );
      assert.equal(result.verdict, 'supported');
      return { ...claim, sourceResult: result };
    }),
  );
  outputs.paraphraseFixture = { input: fixture, claims: assessments };
  console.log(
    'Paraphrase fixture passed: contextual service/death statements, preserved exact offsets, semantic evidence support.',
  );
  const repository = createRepository();
  const pipeline = createPipeline({ onComplete: (check) => repository.save(check) });
  const initial = await pipeline.start({
    answerText: 'The Red Planet has a pair of natural satellites.',
    question: 'How many moons does Mars have?',
    documentText: '',
    sourceUrl: 'https://science.nasa.gov/mars/moons/',
  });
  let previous = '';
  const result = await new Promise((resolve) => {
    const unsubscribe = pipeline.subscribe(initial.id, (job) => {
      if (previous !== job.status) {
        console.log(`Linked-source check: ${job.status}`);
        previous = job.status;
      }
      if (['complete', 'failed'].includes(job.status)) {
        unsubscribe();
        resolve(job);
      }
    });
  });
  outputs.linkedSourceCheck = result;
  await mkdir('.local', { recursive: true });
  await writeFile('.local/live-links-paraphrases.json', JSON.stringify(outputs, null, 2));
  assert.equal(result.status, 'complete', result.error?.message);
  assert.equal(result.claims.length, 1);
  const [claim] = result.claims;
  assert.equal(claim.status, 'complete');
  assert.equal(claim.trustLevel, 'High');
  assert.equal(claim.sourceResult.sourceKind, 'link');
  assert.equal(claim.repeatResult.basis, 'source');
  assert.equal(claim.repeatResult.hits, 5);
  assert.equal(claim.repeatResult.completed, 5);
  assert.ok(result.linkedSource.text.includes(claim.sourceResult.evidenceSnippet));
  assert.equal(result.saved, true);
  const reopened = await repository.get(result.id);
  assert.equal(reopened.sourceUrl, result.sourceUrl);
  assert.ok(reopened.linkedSource.text);
  const token = await repository.share(result.id),
    shared = await repository.shared(token);
  assert.equal(shared.linkedSource?.text, undefined);
  assert.equal(shared.documentText, undefined);
  assert.equal(shared.readOnly, true);
  assert.equal(shared.sourceUrl, result.sourceUrl);
  console.log(
    'Linked-source check passed: real Tavily page extraction, paraphrase evidence, five source-based answers, Atlas reopen, and private-text omission from sharing.',
  );
} finally {
  connection = await getDatabase().catch(() => null);
  await connection?.close();
}

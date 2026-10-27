import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRepository } from '../server/src/repository.js';
import { getDatabase } from '../server/src/db.js';

const check = JSON.parse(await readFile('.local/live-check.json', 'utf8'));
const repository = createRepository();
try {
  await repository.save(check);
  const saved = await repository.get(check.id);
  assert.equal(saved.saved, true);
  assert.equal(saved.claims.length, check.claims.length);
  const cached = await repository.findCached(check);
  assert.equal(cached.id, check.id);
  const history = await repository.history();
  assert.ok(history.checks.some((item) => item.id === check.id));
  const stats = await repository.stats();
  assert.ok(stats.checks >= 1);
  assert.ok(stats.claims >= 1);
  const token = await repository.share(check.id);
  const shared = await repository.shared(token);
  assert.equal(shared.readOnly, true);
  assert.equal(shared.documentText, undefined);
  assert.equal(shared.shareToken, undefined);
  await writeFile('.local/shared-path.txt', `/#/shared/${token}`);
  console.log(
    'Atlas checks passed: saved real result, reopened history, exact-input cache, aggregate stats, and a read-only share that omits the full source document.',
  );
} finally {
  await (await getDatabase()).close();
}

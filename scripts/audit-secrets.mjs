import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

const env = dotenv.parse(await readFile('.env', 'utf8'));
const secrets = [env.GEMINI_API_KEY, env.TAVILY_API_KEY, env.MONGODB_URI].filter(
  (value) => value?.length > 10,
);
if (env.MONGODB_URI) {
  try {
    secrets.push(new URL(env.MONGODB_URI).password);
  } catch {}
}
const skip = new Set(['node_modules', '.git', '.env', '.local']);
let checked = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(entry.name) || (entry.name.startsWith('.env') && entry.name !== '.env.example'))
      continue;
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(name);
      continue;
    }
    if (!/\.(js|jsx|mjs|css|json|html|md|example)$/.test(name)) continue;
    const text = await readFile(name, 'utf8');
    assert.ok(
      !secrets.some((secret) => secret && text.includes(secret)),
      `A private value was found outside .env in ${name}`,
    );
    checked++;
  }
}
await visit('.');
const ignored = await readFile('.gitignore', 'utf8');
assert.ok(ignored.split(/\r?\n/).includes('.env'));
console.log(
  `Secret audit passed: ${checked} source, documentation, configuration, and built frontend files checked. Private values remain in ignored .env.`,
);

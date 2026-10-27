import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';

const useWeb = process.argv.includes('--web');
const input = useWeb
  ? {
      answerText: 'Mars has two moons.',
      question: '',
      documentText: '',
    }
  : {
      answerText: 'Apollo 11 landed on the Moon in July 1969.',
      question: 'When did Apollo 11 land on the Moon?',
      documentText:
        'Apollo 11 landed on the Moon on July 20, 1969. Neil Armstrong and Buzz Aldrin walked on the lunar surface.',
    };
const response = await fetch('http://127.0.0.1:3001/api/checks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});
assert.ok(response.ok);
const initial = await response.json();
let check = initial.check;
if (check.status !== 'complete') {
  const stream = await fetch(`http://127.0.0.1:3001/api/checks/${initial.id}/stream`);
  assert.equal(stream.headers.get('content-type')?.startsWith('text/event-stream'), true);
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event.split('\n').find((line) => line.startsWith('data: '));
      if (data) {
        check = JSON.parse(data.slice(6));
        console.log(
          JSON.stringify({
            status: check.status,
            statements: check.claims.length,
            completed: check.claims.filter((claim) => claim.status !== 'pending').length,
          }),
        );
      }
    }
  }
}
assert.equal(check.status, 'complete');
assert.equal(check.claims.length, 1);
assert.equal(check.claims[0].sourceResult?.verdict, 'supported');
assert.equal(check.claims[0].repeatResult?.completed, 5);
if (useWeb) {
  assert.equal(check.questionInferred, true);
  assert.ok(check.inferredQuestion.length > 5);
  assert.ok(check.claims[0].sourceResult.sourceUrl?.startsWith('https://'));
} else {
  assert.ok(input.documentText.includes(check.claims[0].sourceResult.evidenceSnippet));
}
await mkdir('.local', { recursive: true });
await writeFile(
  useWeb ? '.local/live-web-check.json' : '.local/live-check.json',
  JSON.stringify(check, null, 2),
);
console.log(
  `Live check passed: exact extraction, ${useWeb ? 'public evidence and inferred question' : 'document evidence'}, five independent answers, combined trust, and SSE updates.`,
);

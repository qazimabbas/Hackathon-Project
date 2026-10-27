import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineTrust, repeatCheck, inferQuestion } from '../src/repeat.js';

test('repetition alone never grants High trust and contradictions remain Low', () => {
  const strong = { hits: 5, completed: 5 };
  assert.equal(combineTrust({ verdict: 'not_enough' }, strong), 'Medium');
  assert.equal(combineTrust({ verdict: 'contradicted' }, strong), 'Low');
  assert.equal(combineTrust({ verdict: 'supported' }, strong), 'High');
  assert.equal(combineTrust({ verdict: 'supported' }, { hits: 1, completed: 5 }), 'Medium');
  assert.equal(combineTrust(null, null), 'Medium');
});

test('five answers are independent and failed answers remain unknown, not disagreement', async () => {
  let generationCalls = 0;
  const result = await repeatCheck(
    'What orbits Earth?',
    [{ id: 'moon', claimText: 'The Moon orbits Earth.' }],
    {
      generateJson: async (request) => {
        const input = JSON.parse(request.prompt);
        if (input.claims)
          return { claims: [{ id: 'moon', matches: [true, true, false, true, true] }] };
        assert.deepEqual(input, { question: 'What orbits Earth?' });
        generationCalls++;
        if (generationCalls === 2) throw new Error('Temporary failure.');
        return { answer: 'The Moon orbits Earth.' };
      },
    },
  );
  assert.equal(generationCalls, 5);
  assert.equal(result.results.moon.matches[1], null);
  assert.equal(result.results.moon.completed, 4);
  assert.equal(result.results.moon.hits, 3);
});

test('inferred questions are validated before they are reused', async () => {
  assert.equal(
    await inferQuestion('A text.', { generateJson: async () => ({ question: 'What is a text?' }) }),
    'What is a text?',
  );
  await assert.rejects(inferQuestion('A text.', { generateJson: async () => ({ question: '' }) }), {
    code: 'QUESTION_INFERENCE',
  });
});

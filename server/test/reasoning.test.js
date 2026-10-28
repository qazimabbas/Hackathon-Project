import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateArithmetic, verifyCalculation } from '../src/calculation.js';
import { judgeEvidence, documentSources, sourceTrust } from '../src/evidence.js';
import { repeatCheck } from '../src/repeat.js';
import { locateClaims } from '../src/claims.js';
import { createPipeline } from '../src/pipeline.js';

const documentText = 'Revenue was $200 in 2024 and $250 in 2025. Costs were $150.';
const sources = documentSources(documentText, 'Revenue grew by 25%.');
const input = (name, value) => ({ name, value, sourceId: 'document', exactQuote: documentText });
const calculationOutput = (claimedValue = 25, overrides = {}) => ({
  verdict: 'supported',
  reason: 'Percentage growth uses the change divided by the original revenue.',
  sourceId: 'document',
  exactQuote: documentText,
  assessmentType: 'calculation',
  citations: [{ sourceId: 'document', exactQuote: documentText }],
  calculation: {
    inputs: [input('a', 200), input('b', 250)],
    expression: '(b-a)/a*100',
    claimedValue,
    precision: 0,
    ...overrides,
  },
});

test('arithmetic evaluates supported operations and rejects code, invented constants and division by zero', () => {
  assert.equal(evaluateArithmetic('(b-a)/a*100', { a: 200, b: 250 }), 25);
  assert.equal(evaluateArithmetic('-a + b * (1+1)', { a: 2, b: 3 }), 4);
  for (const expression of ['process.exit()', 'a**b', 'a/0', 'a+25', 'unknown', 'a;1', ''])
    assert.throws(() => evaluateArithmetic(expression, { a: 200, b: 250 }));
});

test('a derived result absent from source text is supported by grounded and independently recomputed arithmetic', async () => {
  assert.ok(!documentText.includes('25%'));
  const result = await judgeEvidence(
    'Revenue grew by 25%.',
    sources,
    {
      generateJson: async (request) => {
        assert.equal(JSON.parse(request.prompt).question, 'What was the revenue growth?');
        return calculationOutput();
      },
    },
    { question: 'What was the revenue growth?' },
  );
  assert.equal(result.verdict, 'supported');
  assert.equal(result.calculation.computedValue, 25);
  assert.equal(result.calculation.verified, true);
  assert.equal(sourceTrust(result.verdict), 'High');
});

test('wrong arithmetic stays contradicted even when the model calls it supported', async () => {
  const result = await judgeEvidence('Revenue grew by 30%.', sources, {
    generateJson: async () => calculationOutput(30),
  });
  assert.equal(result.verdict, 'contradicted');
  assert.match(result.reason, /gives 25/);
  assert.equal(sourceTrust(result.verdict), 'Low');
});

test('numerical equality alone does not override missing premises or conflicting units', async () => {
  for (const verdict of ['not_enough', 'contradicted']) {
    const output = {
      ...calculationOutput(),
      verdict,
      reason: 'The source does not establish the units assumed by this conclusion.',
    };
    const result = await judgeEvidence('Revenue grew by 25%.', sources, {
      generateJson: async () => output,
    });
    assert.equal(result.verdict, verdict);
    assert.equal(result.calculation.correct, true);
    assert.equal(sourceTrust(result.verdict), verdict === 'contradicted' ? 'Low' : 'Medium');
  }
});

test('calculations require actual source numbers and an actual claimed result', async () => {
  for (const output of [
    calculationOutput(25, { inputs: [input('a', 999), input('b', 250)] }),
    calculationOutput(25, {
      inputs: [input('a', 200), { ...input('b', 250), exactQuote: 'Invented quote 250.' }],
    }),
    calculationOutput(25, { expression: 'a+25' }),
    calculationOutput(25, { claimedValue: 99 }),
  ]) {
    const result = await judgeEvidence('Revenue grew by 25%.', sources, {
      generateJson: async () => output,
    });
    assert.equal(result.verdict, 'not_enough');
    assert.equal(sourceTrust(result.verdict), 'Medium');
  }
});

test('arithmetic compares rounded answers at their stated precision', async () => {
  const text = 'There were 3 students and 1 prize.';
  const output = calculationOutput(33.3, {
    inputs: [
      { ...input('a', 1), exactQuote: text },
      { ...input('b', 3), exactQuote: text },
    ],
    expression: 'a/b*100',
    precision: 1,
  });
  output.exactQuote = text;
  output.citations[0].exactQuote = text;
  const result = await judgeEvidence('33.3% received a prize.', documentSources(text, ''), {
    generateJson: async () => output,
  });
  assert.equal(result.verdict, 'supported');
});

test('decimal rounding handles floating-point half cases in either sign', () => {
  for (const sign of [1, -1]) {
    const text = `Numerator ${sign * 1005}, denominator 1000.`;
    const result = verifyCalculation(
      {
        inputs: [
          { ...input('a', sign * 1005), exactQuote: text },
          { ...input('b', 1000), exactQuote: text },
        ],
        expression: 'a/b',
        claimedValue: sign * 1.01,
        precision: 2,
      },
      `Result is ${sign * 1.01}.`,
      documentSources(text, ''),
    );
    assert.equal(result.correct, true);
    assert.equal(result.roundedValue, sign * 1.01);
  }
});

test('multi-premise reasoning preserves verified quotations without requiring the conclusion in the document', async () => {
  const text = 'Mira is older than Ali. Ali is older than Sami.';
  const result = await judgeEvidence('Mira is older than Sami.', documentSources(text, ''), {
    generateJson: async () => ({
      verdict: 'supported',
      reason: 'The two age comparisons imply the conclusion.',
      sourceId: 'document',
      exactQuote: 'Mira is older than Ali.',
      assessmentType: 'reasoned',
      citations: [
        { sourceId: 'document', exactQuote: 'Mira is older than Ali.' },
        { sourceId: 'document', exactQuote: 'Ali is older than Sami.' },
      ],
      calculation: null,
    }),
  });
  assert.equal(result.verdict, 'supported');
  assert.equal(result.citations.length, 2);
});

test('appropriate abstention reviews the full document and question rather than requiring a quote proving absence', async () => {
  const full = 'Only revenue figures are supplied. '.repeat(500);
  const result = await judgeEvidence(
    'The document does not provide enough information to calculate profit.',
    [{ id: 'chunk', text: 'A retrieved fragment.' }],
    {
      generateJson: async (request) => {
        const prompt = JSON.parse(request.prompt);
        assert.equal(prompt.completeDocument, full);
        assert.equal(prompt.question, 'What was profit?');
        return {
          answerable: false,
          reason: 'Costs are missing, so profit cannot be calculated.',
          exactQuote: '',
        };
      },
    },
    { claimKind: 'abstention', question: 'What was profit?', documentText: full },
  );
  assert.equal(result.verdict, 'supported');
  assert.equal(result.reviewScope, 'full_document');
  assert.equal(result.evidenceSnippet, '');
  assert.equal(sourceTrust(result.verdict), 'High');
});

test('unjustified abstention requires an exact source premise and can be contradicted', async () => {
  const result = await judgeEvidence(
    'I cannot calculate profit.',
    sources,
    {
      generateJson: async () => ({
        answerable: true,
        reason: 'Revenue and costs are both available.',
        exactQuote: documentText,
      }),
    },
    { claimKind: 'abstention', question: 'What is 2025 profit?', documentText },
  );
  assert.equal(result.verdict, 'contradicted');
  assert.equal(sourceTrust(result.verdict), 'Low');
  const invalid = await judgeEvidence(
    'I cannot calculate profit.',
    sources,
    {
      generateJson: async () => ({
        answerable: true,
        reason: 'Available.',
        exactQuote: 'Invented premise',
      }),
    },
    { claimKind: 'abstention', question: 'What is profit?', documentText },
  );
  assert.equal(invalid.verdict, 'not_enough');
});

test('an abstention without the original question stays uncertain and never invents an absence assessment', async () => {
  const result = await judgeEvidence(
    'I cannot answer.',
    sources,
    {
      generateJson: async () => {
        throw new Error('Must not call');
      },
    },
    { claimKind: 'abstention', question: '', documentText },
  );
  assert.equal(result.verdict, 'not_enough');
  assert.equal(sourceTrust(result.verdict), 'Medium');
});

test('abstentions retain exact answer offsets and a distinct kind', () => {
  const answer = 'I cannot answer this from the document.';
  const [claim] = locateClaims(answer, { claims: [{ exactQuote: answer, kind: 'abstention' }] });
  assert.equal(claim.kind, 'abstention');
  assert.equal(answer.slice(claim.startIndex, claim.endIndex), answer);
});

test('fresh document answers receive the same question and document, never the answer being checked', async () => {
  let samples = 0;
  const result = await repeatCheck(
    'What is growth?',
    [{ id: 'c', claimText: 'Growth is 25%.' }],
    {
      generateJson: async (request) => {
        const prompt = JSON.parse(request.prompt);
        if (prompt.claims)
          return { claims: [{ id: 'c', matches: [true, true, null, true, true] }] };
        assert.deepEqual(prompt, { question: 'What is growth?', documentText });
        assert.match(request.system, /ONLY the supplied document/);
        samples++;
        return { answer: 'Revenue increased by one quarter.' };
      },
    },
    { documentText },
  );
  assert.equal(samples, 5);
  assert.equal(result.results.c.basis, 'document');
  assert.equal(result.results.c.completed, 4);
  assert.equal(result.results.c.hits, 4);
});

test('pipeline passes source task context to judging and repeat checks', async () => {
  const answer = 'Profit cannot be determined from this document.';
  const pipeline = createPipeline({
    extractor: async () =>
      locateClaims(answer, { claims: [{ exactQuote: answer, kind: 'abstention' }] }),
    repeat: async (question, _claims, _provider, context) => {
      assert.equal(question, 'What was profit?');
      assert.equal(context.documentText, documentText);
      return { results: {} };
    },
    judge: async (_claim, _sources, _provider, context) => {
      assert.equal(context.question, 'What was profit?');
      assert.equal(context.claimKind, 'abstention');
      assert.equal(context.documentText, documentText);
      return {
        verdict: 'supported',
        sourceKind: 'document',
        assessmentType: 'abstention',
        reason: 'Missing costs.',
      };
    },
  });
  const initial = await pipeline.start({
    answerText: answer,
    question: 'What was profit?',
    documentText,
  });
  const final = await new Promise((resolve) => {
    const unsubscribe = pipeline.subscribe(initial.id, (job) => {
      if (job.status === 'complete') {
        unsubscribe();
        resolve(job);
      }
    });
  });
  assert.equal(final.claims[0].trustLevel, 'High');
  assert.equal(final.claims[0].kind, 'abstention');
});

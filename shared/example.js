// Curated local fixture, bundled into the frontend for offline demonstrations.
const sentences = [
  'The first crewed Moon landing took place in July 1969.',
  'Apollo 11 carried Neil Armstrong, Buzz Aldrin, and Michael Collins.',
  'All three astronauts walked on the lunar surface.',
  'The crew stayed on the Moon for an entire week.',
  'The mission returned safely to Earth on July 24, 1969.',
];
const answerText = sentences.join(' ');
let cursor = 0;
export const example = {
  id: 'saved-apollo-example',
  mode: 'example',
  status: 'extracted',
  createdAt: '2026-10-27T00:00:00.000Z',
  answerText,
  question: 'What happened during the Apollo 11 mission?',
  documentText:
    'Apollo 11 launched on July 16, 1969. Neil Armstrong and Buzz Aldrin landed on the Moon on July 20, while Michael Collins remained in lunar orbit. Armstrong and Aldrin spent about 21 hours on the lunar surface. The three astronauts returned to Earth on July 24, 1969.',
  claims: sentences.map((claimText, index) => {
    const startIndex = answerText.indexOf(claimText, cursor);
    cursor = startIndex + claimText.length;
    return {
      id: `example-claim-${index + 1}`,
      claimText,
      startIndex,
      endIndex: cursor,
      status: 'extracted',
      trustLevel: null,
    };
  }),
};

const quotes = [
  'Neil Armstrong and Buzz Aldrin landed on the Moon on July 20, while Michael Collins remained in lunar orbit.',
  'Neil Armstrong and Buzz Aldrin landed on the Moon on July 20, while Michael Collins remained in lunar orbit.',
  'Neil Armstrong and Buzz Aldrin landed on the Moon on July 20, while Michael Collins remained in lunar orbit.',
  'Armstrong and Aldrin spent about 21 hours on the lunar surface.',
  'The three astronauts returned to Earth on July 24, 1969.',
];
example.claims = example.claims.map((claim, index) => ({
  ...claim,
  status: 'complete',
  trustLevel: [2, 3].includes(index) ? 'Low' : 'High',
  reasonText: [
    'Your document places the landing in July 1969.',
    'Your document names Armstrong, Aldrin, and Collins as the mission crew.',
    'Your document says Collins stayed in lunar orbit while Armstrong and Aldrin landed.',
    'Your document describes about 21 hours on the surface, rather than an entire week.',
    'Your document gives the return date as July 24, 1969.',
  ][index],
  sourceResult: {
    verdict: [2, 3].includes(index) ? 'contradicted' : 'supported',
    sourceKind: 'document',
    evidenceSnippet: quotes[index],
    sourceTitle: 'Your document',
    sourceUrl: null,
  },
}));
example.status = 'complete';
example.questionInferred = false;
example.warnings = [
  'This saved example uses curated evidence and simulated repeat answers. It does not make live API calls.',
];
example.claims = example.claims.map((claim, index) => ({
  ...claim,
  repeatResult: {
    matches: [
      [true, true, true, true, true],
      [true, true, true, true, true],
      [false, false, true, false, false],
      [false, false, false, false, true],
      [true, true, true, false, true],
    ][index],
    hits: [5, 5, 1, 1, 4][index],
    completed: 5,
  },
  repeatHits: [5, 5, 1, 1, 4][index],
}));
example.overallSummary = { total: 5, High: 3, Medium: 0, Low: 2, pending: 0, errors: 0 };

export const comparisonLabels = {
  agreed: 'Agreed',
  disagreed: 'Disagreed',
  not_addressed: 'Needs review',
  generation_failed: 'Needs review',
  comparison_failed: 'Needs review',
  unavailable: 'Needs review',
  needs_review: 'Needs review',
  source_supported: 'Source supports',
  source_contradicted: 'Source contradicts',
};

export function checkStatus(result, index, source) {
  if (result.matches[index] === true) return 'agreed';
  if (result.matches[index] === false) return 'disagreed';
  const recorded = result.comparisons?.[index]?.status;
  if (['source_supported', 'source_contradicted'].includes(recorded)) return recorded;
  return source?.verdict === 'supported'
    ? 'source_supported'
    : source?.verdict === 'contradicted'
      ? 'source_contradicted'
      : 'needs_review';
}

export function agreementLabel(result, source) {
  const basis =
    result.basis === 'source'
      ? 'source-based '
      : result.basis === 'document'
        ? 'document-based '
        : '';
  const statuses = result.matches.map((_match, index) => checkStatus(result, index, source));
  const fallback = statuses.filter((status) => status.startsWith('source_')).length;
  const review = statuses.filter((status) => status === 'needs_review').length;
  const parts = [];
  if (result.completed)
    parts.push(`${result.hits} of ${result.completed} comparable ${basis}Gemini checks agreed.`);
  if (fallback)
    parts.push(`Source fallback used for ${fallback} check${fallback === 1 ? '' : 's'}.`);
  if (review)
    parts.push(`${review} check${review === 1 ? '' : 's'} need${review === 1 ? 's' : ''} review.`);
  return parts.join(' ');
}

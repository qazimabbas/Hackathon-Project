export const comparisonLabels = {
  agreed: 'Agreed',
  disagreed: 'Disagreed',
  not_addressed: 'Not addressed',
  generation_failed: 'Generation failed',
  comparison_failed: 'Comparison unavailable',
  unavailable: 'Unavailable',
};

export function agreementLabel(result) {
  const basis =
    result.basis === 'source'
      ? 'source-based '
      : result.basis === 'document'
        ? 'document-based '
        : '';
  if (result.generated === undefined) {
    return result.completed
      ? `${result.hits} of ${result.completed} comparable ${basis}answers agreed${result.completed < 5 ? `; ${5 - result.completed} comparisons unknown` : ''}`
      : 'No comparable answers were recorded. This earlier check has no detailed comparison reasons.';
  }
  if (result.generated === null)
    return 'Gemini answer agreement is unavailable. See the comparison details.';
  const failed = result.generationFailed
    ? ` ${result.generationFailed} generation${result.generationFailed === 1 ? '' : 's'} failed.`
    : '';
  if (!result.generated) return 'No Gemini answers could be generated. See the failure details.';
  if (!result.completed && result.comparisonFailed)
    return `${result.generated} answers generated; answer comparison was unavailable.${failed}`;
  if (!result.completed)
    return `${result.generated} answers generated; none addressed this complete statement.${failed}`;
  return `${result.hits} of ${result.completed} comparable ${basis}answers agreed${result.unaddressed ? `; ${result.unaddressed} did not address the full statement` : ''}.${failed}`;
}

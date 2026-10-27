import { useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleHelp, Link, ShieldCheck } from 'lucide-react';

const icons = { High: '✓', Medium: '!', Low: '?' };
export function TrustBadge({ level, error = false }) {
  return (
    <span className="trust-badge" data-level={level || 'pending'}>
      <span aria-hidden="true">{error ? '!' : icons[level] || '◌'}</span>
      {error ? 'Check incomplete' : level ? `${level} trust` : 'Checking...'}
    </span>
  );
}
export function AgreementDots({ result, compact = false }) {
  const label =
    result.completed === 5
      ? `The AI repeated this ${result.hits} out of 5 times`
      : `Repeated in ${result.hits} of ${result.completed} checked answers; ${5 - result.completed} unavailable`;
  return (
    <div className={`agreement ${compact ? 'compact' : ''}`}>
      <span className="agreement-dots" role="img" aria-label={label}>
        {result.matches.map((match, index) => (
          <i key={index} className={match === null ? 'unknown' : match ? 'filled' : ''}>
            {match === null ? '?' : match ? '✓' : ''}
          </i>
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

export function TrustMap({ check, onSelect, mini = false }) {
  let cursor = 0;
  const segments = [];
  check.claims.forEach((claim, index) => {
    if (claim.startIndex > cursor)
      segments.push(
        <span
          key={`gap-${index}`}
          className="map-gap"
          style={{ flexGrow: claim.startIndex - cursor }}
          title="Text without an extracted statement"
        />,
      );
    const props = {
      'data-level': claim.trustLevel || 'pending',
      title: `Statement ${index + 1}: ${claim.trustLevel || 'Pending'}${claim.trustLevel ? ' trust' : ''}. ${claim.reasonText || ''}`,
      style: { flexGrow: claim.endIndex - claim.startIndex },
    };
    segments.push(
      mini ? (
        <span key={claim.id} {...props} />
      ) : (
        <button
          key={claim.id}
          {...props}
          onClick={() => onSelect(claim.id)}
          aria-label={`Go to statement ${index + 1}, ${claim.trustLevel || 'pending'} trust`}
        >
          {icons[claim.trustLevel] || '·'}
        </button>
      ),
    );
    cursor = claim.endIndex;
  });
  if (cursor < check.answerText.length)
    segments.push(
      <span className="map-gap" key="end" style={{ flexGrow: check.answerText.length - cursor }} />,
    );
  return (
    <div
      className={`trust-map ${mini ? 'mini' : ''}`}
      aria-label={mini ? 'Trust map preview' : 'Trust map of the original answer'}
    >
      {segments}
    </div>
  );
}

export function ResultSummary({ check }) {
  const counts = { High: 0, Medium: 0, Low: 0, pending: 0 };
  for (const claim of check.claims) counts[claim.trustLevel || 'pending']++;
  const total = check.claims.length;
  let offset = 0;
  return (
    <div className="result-summary">
      <div className="donut">
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label={`${counts.High} of ${total} statements look reliable`}
        >
          <circle cx="50" cy="50" r="40" className="donut-base" />
          {['High', 'Medium', 'Low', 'pending'].map((level) => {
            const length = total ? (counts[level] / total) * 251.327 : 0;
            const item = (
              <circle
                key={level}
                cx="50"
                cy="50"
                r="40"
                data-level={level}
                strokeDasharray={`${length} 251.327`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return item;
          })}
        </svg>
        <span>
          {counts.High}
          <small>of {total}</small>
        </span>
      </div>
      <div>
        <span className="eyebrow">THE BIG PICTURE</span>
        <h2>
          {total
            ? `${counts.High} of ${total} statements look reliable`
            : 'Finding statements to check'}
        </h2>
        <p>
          {counts.pending
            ? `${total - counts.pending} checked. Evidence is still coming in.`
            : 'A guide to the evidence, with room for uncertainty.'}
        </p>
        <div className="trust-legend">
          {['High', 'Medium', 'Low'].map((level) => (
            <span key={level} data-level={level}>
              <b>{icons[level]}</b>
              {counts[level]} {level.toLowerCase()}
            </span>
          ))}
        </div>
      </div>
      {check.cached && (
        <span className="cached-badge">
          <Check size={12} />
          From saved results
        </span>
      )}
    </div>
  );
}

const wordSet = (text) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter(
      (word) =>
        ![
          'that',
          'with',
          'from',
          'this',
          'were',
          'have',
          'been',
          'they',
          'their',
          'about',
          'which',
        ].includes(word),
    ),
  );
function MatchedText({ text, other }) {
  const common = wordSet(other);
  return text
    .split(/([\p{L}\p{N}]+)/gu)
    .map((part, index) => (common.has(part.toLowerCase()) ? <em key={index}>{part}</em> : part));
}

function EvidencePanel({ claim }) {
  if (!claim) return null;
  const source = claim.sourceResult;
  const label =
    source?.verdict === 'supported'
      ? source.sourceKind === 'document'
        ? 'Backed by your document'
        : 'Backed by a public source'
      : source?.verdict === 'contradicted'
        ? source.sourceKind === 'document'
          ? 'Goes against your document'
          : 'Goes against a public source'
        : 'No proof found';
  return (
    <div className="evidence-detail">
      <div className="evidence-heading">
        <div>
          <span className="eyebrow">FOLLOW THE EVIDENCE</span>
          <h3>{claim.status === 'pending' ? 'Looking for a closer match...' : label}</h3>
        </div>
        <TrustBadge level={claim.trustLevel} error={claim.status === 'error'} />
      </div>
      <p>
        {claim.reasonText || 'Comparing the statement with its sources and the repeated answers.'}
      </p>
      <div className="evidence-columns">
        <div>
          <span className="evidence-column-label">THE STATEMENT</span>
          <blockquote>
            <MatchedText text={claim.claimText} other={source?.evidenceSnippet || ''} />
          </blockquote>
        </div>
        <div>
          <span className="evidence-column-label">
            {source?.sourceKind === 'document' ? 'YOUR DOCUMENT SAYS' : 'THE SOURCE SAYS'}
          </span>
          <blockquote>
            {source?.evidenceSnippet ? (
              <MatchedText text={source.evidenceSnippet} other={claim.claimText} />
            ) : claim.status === 'pending' ? (
              'Evidence will appear here as the check finishes.'
            ) : (
              'No matching passage could be verified for this statement.'
            )}
          </blockquote>
          {source?.sourceUrl ? (
            <a
              className="source-link"
              href={source.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {source.sourceTitle}
              <ArrowUpRight size={13} />
            </a>
          ) : (
            source?.sourceTitle && <span className="source-label">{source.sourceTitle}</span>
          )}
        </div>
      </div>
      {claim.repeatResult && (
        <div className="repeat-detail">
          <span className="evidence-column-label">DOES THE AI KEEP SAYING IT?</span>
          <AgreementDots result={claim.repeatResult} />
          <p>
            {claim.repeatResult.completed === 5 && claim.repeatResult.hits === 5
              ? 'The AI gave the same answer every time'
              : claim.repeatResult.completed >= 3 && claim.repeatResult.hits < 3
                ? 'The AI kept changing its answer'
                : 'Some answers included this statement.'}{' '}
            Repetition alone does not prove a statement is reliable.
          </p>
        </div>
      )}
      {claim.warnings?.map((warning, index) => (
        <p className="claim-warning" key={index}>
          <CircleHelp size={13} />
          {warning}
        </p>
      ))}
    </div>
  );
}

export default function ResultView({ check, selectedId, onSelect, onShare, readOnly = false }) {
  const [view, setView] = useState('highlight');
  const [shareMessage, setShareMessage] = useState('');
  const claimRefs = useRef(new Map());
  const selected = check.claims.find((claim) => claim.id === selectedId);
  const selectFromMap = (id) => {
    onSelect(id);
    setView('highlight');
    requestAnimationFrame(() =>
      claimRefs.current.get(id)?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'center',
      }),
    );
  };
  let cursor = 0;
  const parts = [];
  for (const claim of check.claims) {
    parts.push(check.answerText.slice(cursor, claim.startIndex));
    parts.push(
      <mark
        key={claim.id}
        data-level={claim.trustLevel || 'pending'}
        className={selectedId === claim.id ? 'selected' : ''}
        ref={(element) => {
          if (element) claimRefs.current.set(claim.id, element);
          else claimRefs.current.delete(claim.id);
        }}
      >
        <button
          type="button"
          onClick={() => onSelect(claim.id)}
          title={claim.reasonText || 'This statement is being checked.'}
          aria-label={`${claim.trustLevel || 'Pending'}${claim.trustLevel ? ' trust' : ''}: ${claim.claimText}`}
        >
          {check.answerText.slice(claim.startIndex, claim.endIndex)}
        </button>
      </mark>,
    );
    cursor = claim.endIndex;
  }
  parts.push(check.answerText.slice(cursor));
  return (
    <section className="original-card full-result" aria-labelledby="original-heading">
      <ResultSummary check={check} />
      <div className="map-label">
        <span className="eyebrow">YOUR ANSWER AT A GLANCE</span>
        <span>Choose a segment to find its statement</span>
      </div>
      <TrustMap check={check} onSelect={selectFromMap} />
      <div className="result-toolbar">
        <div
          className="view-tabs"
          role="tablist"
          aria-label="Result view"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'highlight'
                : event.key === 'End'
                  ? 'agreement'
                  : view === 'highlight'
                    ? 'agreement'
                    : 'highlight';
            setView(next);
            requestAnimationFrame(() => document.getElementById(`${next}-tab`)?.focus());
          }}
        >
          <button
            role="tab"
            aria-selected={view === 'highlight'}
            tabIndex={view === 'highlight' ? 0 : -1}
            aria-controls="highlight-panel"
            id="highlight-tab"
            onClick={() => setView('highlight')}
          >
            Highlight view
          </button>
          <button
            role="tab"
            aria-selected={view === 'agreement'}
            tabIndex={view === 'agreement' ? 0 : -1}
            aria-controls="agreement-panel"
            id="agreement-tab"
            onClick={() => setView('agreement')}
          >
            Agreement view
          </button>
        </div>
        {onShare && check.status === 'complete' && check.mode !== 'example' && !readOnly && (
          <button
            className="share-button"
            onClick={async () => {
              try {
                setShareMessage('Creating link...');
                const url = await onShare(check.id);
                try {
                  await navigator.clipboard.writeText(url);
                  setShareMessage('Read-only link copied');
                } catch {
                  setShareMessage(url);
                }
              } catch {
                setShareMessage('Could not create the link. Check the database connection.');
              }
            }}
          >
            <Link size={13} />
            Share result
          </button>
        )}
      </div>
      {shareMessage && (
        <p className="share-message" role="status">
          {shareMessage}
        </p>
      )}
      <h2 id="original-heading" className="result-title">
        {readOnly ? 'A shared answer, under the lens' : 'The original answer'}
      </h2>
      {view === 'highlight' ? (
        <div role="tabpanel" id="highlight-panel" aria-labelledby="highlight-tab">
          <p className="original-answer">{parts}</p>
          <p className="snapshot-note">
            Choose a highlighted statement to see its evidence.{' '}
            {readOnly
              ? 'This is a read-only result.'
              : 'Check again after editing the input below.'}
          </p>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="agreement-panel"
          aria-labelledby="agreement-tab"
          className="agreement-list"
        >
          {check.claims.map((claim, index) => (
            <button
              key={claim.id}
              onClick={() => onSelect(claim.id)}
              className={selectedId === claim.id ? 'selected' : ''}
            >
              <span className="claim-number">0{index + 1}</span>
              <span>
                <span>{claim.claimText}</span>
                {claim.repeatResult ? (
                  <AgreementDots result={claim.repeatResult} />
                ) : (
                  <p className="muted">The repeat answers are still being checked.</p>
                )}
              </span>
              <TrustBadge level={claim.trustLevel} error={claim.status === 'error'} />
            </button>
          ))}
        </div>
      )}
      <EvidencePanel claim={selected} />
    </section>
  );
}

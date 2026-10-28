import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  FileText,
  Layers3,
  Link2,
  LoaderCircle,
  Moon,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { example } from '../../shared/example.js';
import ResultView, { AgreementDots, TrustBadge } from './Results.jsx';
import { HistoryPage, SharedPage, StatsPage } from './Pages.jsx';
import SourceDocument from './SourceDocument.jsx';
import { readCheckStream } from './checkStream.js';

const initialLimits = { answer: 12000, question: 2000, document: 60000, claims: 10 };
const steps = [
  {
    icon: ScanLine,
    title: 'Find the statements',
    text: 'Break an answer into small statements that can be checked.',
    active: true,
  },
  {
    icon: BookOpen,
    title: 'Follow the evidence',
    text: 'Compare each statement with your document or public sources.',
    active: true,
  },
  {
    icon: Layers3,
    title: 'See the bigger picture',
    text: 'See the supporting evidence and where the AI changes its answer.',
    active: true,
  },
];

function Logo({ small = false }) {
  return (
    <span className={`logo-symbol ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function ReadingGuide({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button close-button"
          onClick={onClose}
          aria-label="Close guide"
          autoFocus
        >
          <X size={20} />
        </button>
        <span className="eyebrow">A LITTLE CONTEXT</span>
        <h2 id="guide-title">A confident answer can still need a second look.</h2>
        <p>
          AI can produce made-up or unsupported information. Hallucination Visualizer helps you
          inspect the statements and their evidence.
        </p>
        <p>
          The app finds up to 10 factual statements. Add a source document by pasting text or
          choosing a PDF, Word, or text file, or choose a source link instead. Use one source type
          per check. Without either, the app searches public sources. Select a highlighted passage
          to read its evidence.
        </p>
        <p>
          High trust means the available source supports the statement, its reasoning, a verified
          calculation, or an appropriate response that the supplied source lacks enough information.
          Low trust means the evidence contradicts it. Medium trust means the evidence is
          insufficient or uncertain. These rules apply to documents, links, and public sources.
        </p>
        <p>
          Gemini answer agreement shows how often five fresh Gemini answers agree with each
          statement. It does not change the trust label or measure the original AI model’s
          consistency. Gemini can repeat the same mistake or miss a correct answer.
        </p>
        <div className="honesty-note">
          <ShieldCheck size={18} />
          <span>
            This tool can also make mistakes. Always review important information yourself.
          </span>
        </div>
      </section>
    </div>
  );
}

function StatementList({ result, selectedId, onSelect, loading, resultsRef }) {
  return (
    <section
      className={`results-card ${result ? 'has-results' : ''}`}
      ref={resultsRef}
      tabIndex={-1}
      aria-labelledby="statements-heading"
      aria-busy={loading}
    >
      <div className="card-heading">
        <div className="heading-icon">
          <Layers3 size={19} />
        </div>
        <h2 id="statements-heading">Statements to check</h2>
        <span className="count-pill">{result?.claims.length ?? '0'}</span>
      </div>
      {loading && !result?.claims.length ? (
        <div className="pending-results" role="status">
          <LoaderCircle className="spin" size={22} />
          <h3>Reading between the lines...</h3>
          <p>
            {result?.status === 'checking'
              ? 'Looking for evidence and repeated answers.'
              : 'Finding individual statements in your answer.'}
          </p>
          <div className="skeleton" />
          <div className="skeleton short" />
          <div className="skeleton" />
        </div>
      ) : result ? (
        <>
          <div className="result-context">
            <span className="status-label">
              {result.mode === 'example' ? <Sparkles size={13} /> : <Check size={13} />}
              {result.mode === 'example' ? 'Saved example' : 'Statements found'}
            </span>
            <span>
              {result.sourceUrl
                ? 'Compared with your linked source'
                : result.documentText
                  ? 'Compared with your document'
                  : 'Public-source check'}
            </span>
          </div>
          {result.claims.length ? (
            <ol className="claim-list">
              {result.claims.map((claim, index) => (
                <li key={claim.id}>
                  <button
                    className={`claim-button ${selectedId === claim.id ? 'selected' : ''} ${claim.status === 'pending' ? 'pending' : ''}`}
                    onClick={() => onSelect(claim.id)}
                    aria-pressed={selectedId === claim.id}
                  >
                    <span className="claim-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="claim-content">
                      <span>{claim.claimText}</span>
                      {claim.trustLevel || claim.status === 'error' ? (
                        <TrustBadge level={claim.trustLevel} error={claim.status === 'error'} />
                      ) : (
                        <span className="unverified">
                          <span className="empty-dot" />
                          {claim.status === 'pending' ? 'Checking...' : 'Not checked'}
                        </span>
                      )}
                      {claim.repeatResult && <AgreementDots result={claim.repeatResult} compact />}
                    </span>
                    <ArrowUpRight className="claim-arrow" size={15} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="no-claims">
              <CircleHelp size={24} />
              <h3>No factual statements found</h3>
              <p>Try an answer with specific facts, dates, names, or events.</p>
            </div>
          )}
          {result.claims.length > 0 && (
            <p className="result-footnote">Select a statement to see its evidence.</p>
          )}
        </>
      ) : (
        <div className="empty-results">
          <div className="paper-illustration" aria-hidden="true">
            <div className="paper-corner" />
            <div className="paper-line" />
            <div className="paper-line medium" />
            <div className="paper-highlight">
              <span />
            </div>
            <div className="paper-line" />
            <div className="paper-line short" />
            <div className="paper-highlight second">
              <span />
            </div>
            <div className="scan-corner a" />
            <div className="scan-corner b" />
          </div>
          <h3>A clearer picture starts here.</h3>
          <p>Paste an answer, and we’ll pull out the statements worth a closer look.</p>
          <span className="empty-caption">Up to 10 statements per answer</span>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  const [answerText, setAnswerText] = useState('');
  const [question, setQuestion] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceMode, setSourceMode] = useState('document');
  const [documentRevision, setDocumentRevision] = useState(0);
  const [documentImporting, setDocumentImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limits, setLimits] = useState(initialLimits);
  const [guide, setGuide] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return (
        localStorage.getItem('hv-theme') ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      );
    } catch {
      return 'light';
    }
  });
  const resultsRef = useRef(null);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  const requestNumber = useRef(0);
  const guideButtonRef = useRef(null);
  const isWorkspace = route === '/' || route.startsWith('/checks/');

  useEffect(() => {
    const navigate = () => setRoute(location.hash.slice(1) || '/');
    addEventListener('hashchange', navigate);
    return () => removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    if (!route.startsWith('/checks/')) return;
    const controller = new AbortController();
    requestNumber.current++;
    requestRef.current?.abort();
    streamRef.current?.close();
    setLoading(false);
    setResult(null);
    setError('');
    fetch(`/api/checks/${encodeURIComponent(route.slice('/checks/'.length))}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message || 'The saved check could not be loaded.');
        return body.check;
      })
      .then((check) => {
        setAnswerText(check.answerText);
        setQuestion(check.question || '');
        setDocumentText(check.documentText || '');
        setSourceUrl(check.sourceUrl || '');
        setSourceMode(check.sourceUrl ? 'link' : 'document');
        setDocumentRevision((revision) => revision + 1);
        setResult(check);
        setSelectedId(check.claims[0]?.id || null);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof TypeError ? 'Could not reach the history server.' : failure.message,
          );
      });
    return () => controller.abort();
  }, [route]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('hv-theme', theme);
    } catch {
      /* Theme still works when browser storage is unavailable. */
    }
  }, [theme]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.limits) setLimits(data.limits);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      requestRef.current?.abort();
      streamRef.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!guide) return;
    const handler = (event) => {
      if (event.key === 'Escape') {
        setGuide(false);
        guideButtonRef.current?.focus();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        document.querySelector('.close-button')?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = oldOverflow;
    };
  }, [guide]);

  function reset() {
    requestNumber.current++;
    requestRef.current?.abort();
    streamRef.current?.close();
    setLoading(false);
    setAnswerText('');
    setQuestion('');
    setDocumentText('');
    setSourceUrl('');
    setSourceMode('document');
    setDocumentRevision((revision) => revision + 1);
    setResult(null);
    setSelectedId(null);
    setError('');
    document.getElementById('answer')?.focus();
  }
  function tryExample() {
    requestNumber.current++;
    requestRef.current?.abort();
    streamRef.current?.close();
    setLoading(false);
    setAnswerText(example.answerText);
    setQuestion(example.question);
    setDocumentText(example.documentText);
    setSourceUrl('');
    setSourceMode('document');
    setDocumentRevision((revision) => revision + 1);
    setResult(example);
    setSelectedId(example.claims[0].id);
    setError('');
    requestAnimationFrame(() =>
      document.querySelector('.full-result')?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'start',
      }),
    );
  }
  async function checkAnswer(event) {
    event.preventDefault();
    if (!answerText.trim() || loading || documentImporting) return;
    const attempt = ++requestNumber.current;
    const controller = new AbortController();
    requestRef.current = controller;
    streamRef.current?.close();
    setLoading(true);
    setError('');
    setResult(null);
    setSelectedId(null);
    let showedResults = false;
    const receiveSnapshot = (check) => {
      if (attempt !== requestNumber.current) return;
      setError('');
      setResult(check);
      if (!showedResults && check.claims.length) {
        showedResults = true;
        requestAnimationFrame(() =>
          document.querySelector('.full-result')?.scrollIntoView({
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
            block: 'start',
          }),
        );
      }
      setSelectedId((previous) => previous || check.claims[0]?.id || null);
      if (['complete', 'failed'].includes(check.status)) {
        streamRef.current?.close();
        setLoading(false);
        if (check.error) setError(check.error.message);
      }
    };
    try {
      const response = await fetch('/api/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          answerText,
          question,
          documentText: sourceMode === 'document' ? documentText : '',
          sourceUrl: sourceMode === 'link' ? sourceUrl : '',
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(310000)]),
      });
      if (response.ok && response.headers.get('Content-Type')?.includes('text/event-stream')) {
        await readCheckStream(response, receiveSnapshot);
        return;
      }
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || 'The check could not finish. Please try again.');
      if (attempt !== requestNumber.current) return;
      setResult(body.check);
      setSelectedId(body.check.claims[0]?.id ?? null);
      if (body.check.status === 'complete') {
        setLoading(false);
        return;
      }
      const stream = new EventSource(`/api/checks/${encodeURIComponent(body.id)}/stream`);
      streamRef.current = stream;
      let failures = 0;
      stream.addEventListener('snapshot', (message) => {
        if (attempt !== requestNumber.current) {
          stream.close();
          return;
        }
        try {
          const check = JSON.parse(message.data);
          failures = 0;
          receiveSnapshot(check);
        } catch {
          stream.close();
          setLoading(false);
          setError('The check updates could not be read. Please try again.');
        }
      });
      stream.onerror = () => {
        if (attempt !== requestNumber.current) {
          stream.close();
          return;
        }
        failures++;
        if (failures >= 3) {
          stream.close();
          setLoading(false);
          setError(
            'The connection to this check was lost. Reopen it from history or check the server connection.',
          );
        } else setError('The connection was interrupted. Reconnecting to this check...');
      };
    } catch (failure) {
      if (attempt !== requestNumber.current || controller.signal.aborted) return;
      setError(
        failure instanceof TypeError || failure instanceof SyntaxError
          ? 'Could not reach the app server. Check your connection and try again. The saved example still works.'
          : failure.message,
      );
      setLoading(false);
    }
  }
  const atLimit = answerText.length >= limits.answer;
  const closeGuide = () => {
    setGuide(false);
    guideButtonRef.current?.focus();
  };

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Hallucination Visualizer home">
          <Logo />
          <span>
            Hallucination<span className="brand-second">Visualizer</span>
          </span>
          <span className="beta-tag">BETA</span>
        </a>
        <nav className="header-center" aria-label="Main navigation">
          <a href="#/" className={isWorkspace ? 'active' : ''}>
            <span className="nav-dot" />
            Workspace
          </a>
          <a href="#/history" className={route === '/history' ? 'active' : ''}>
            History
          </a>
          <a href="#/stats" className={route === '/stats' ? 'active' : ''}>
            Stats
          </a>
        </nav>
        <div className="header-actions">
          <button className="guide-button" ref={guideButtonRef} onClick={() => setGuide(true)}>
            <CircleHelp size={16} />
            <span>How it works</span>
          </button>
          <div className="header-divider" />
          <button
            className="icon-button"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </header>
      <main>
        {isWorkspace ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" />A SECOND LOOK AT AI
                </div>
                <h1>
                  Your answer,
                  <br />
                  under the{' '}
                  <span>
                    lens
                    <svg viewBox="0 0 180 13" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M2 10C45 0 120 0 178 6" />
                    </svg>
                  </span>
                  .
                </h1>
                <p>
                  See which parts of an AI answer are real
                  <br className="desktop-break" /> and which parts may be made up.
                </p>
              </div>
              <div className="hero-aside">
                <div className="lens-orbit" aria-hidden="true">
                  <div className="orbit-line one" />
                  <div className="orbit-line two" />
                  <div className="lens-glass">
                    <ScanLine size={34} strokeWidth={1.3} />
                  </div>
                  <span className="orbit-dot d1" />
                  <span className="orbit-dot d2" />
                  <span className="orbit-dot d3" />
                </div>
                <p>
                  A little less guesswork.
                  <br />
                  <strong>A lot more clarity.</strong>
                </p>
              </div>
            </section>
            <div className="workspace-meta">
              <div>
                <span className="workspace-label">THE WORKSPACE</span>
                <span className="meta-separator">/</span>
                <span>Start with an answer. Follow the facts.</span>
              </div>
              <span className="phase-badge">
                <span />
                Evidence first
              </span>
            </div>
            {result?.warnings?.length > 0 && (
              <div className="check-notices" role="status">
                {result.warnings.map((warning, index) => (
                  <p key={index}>
                    <CircleHelp size={14} />
                    {warning}
                  </p>
                ))}
                {result.inferredQuestion && <p>Question we used: “{result.inferredQuestion}”</p>}
              </div>
            )}
            {result?.linkedSource?.url && (
              <div className="check-notices linked-source-notice" role="status">
                <p>
                  <Link2 size={15} />
                  Source read:{' '}
                  <a href={result.linkedSource.url} target="_blank" rel="noopener noreferrer">
                    {result.linkedSource.title}
                  </a>
                </p>
                <p>
                  The check uses readable content from this page
                  {result.documentText ? ' together with your document' : ''}.
                </p>
              </div>
            )}
            {result && (result.claims.length > 0 || result.status === 'complete') && (
              <ResultView
                check={result}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onShare={async (id) => {
                  const response = await fetch(`/api/checks/${encodeURIComponent(id)}/share`, {
                    method: 'POST',
                  });
                  const body = await response.json();
                  if (!response.ok) throw new Error('Sharing unavailable.');
                  return new URL(body.path, location.origin).href;
                }}
              />
            )}
            <div className="workspace-grid">
              <section className="composer-card" aria-labelledby="answer-heading">
                <div className="card-heading">
                  <div className="heading-icon">
                    <FileText size={19} />
                  </div>
                  <h2 id="answer-heading">Give your answer a closer look</h2>
                  <button
                    className="reset-button"
                    type="button"
                    onClick={reset}
                    aria-label="Clear answer and results"
                  >
                    <RotateCcw size={14} />
                    <span>Reset</span>
                  </button>
                </div>
                <form onSubmit={checkAnswer}>
                  <div className="answer-field">
                    <div className="field-label-row">
                      <label htmlFor="answer">The AI answer</label>
                      <span>Required</span>
                    </div>
                    <textarea
                      id="answer"
                      value={answerText}
                      onChange={(event) => setAnswerText(event.target.value)}
                      maxLength={limits.answer}
                      placeholder="Paste an AI answer here"
                      required
                      spellCheck="false"
                      aria-describedby="answer-hint"
                    />
                    <div className="textarea-footer">
                      <span id="answer-hint">Facts, dates, names. Let’s take a closer look.</span>
                      <span className={atLimit ? 'at-limit' : ''}>
                        {answerText.length.toLocaleString()} / {limits.answer.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="question-field context-inner">
                    <label htmlFor="question">
                      Original question <span>(helps a lot)</span>
                    </label>
                    <input
                      id="question"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={limits.question}
                      placeholder="What did you ask the AI?"
                    />
                  </div>
                  <fieldset className="source-choice" disabled={loading || documentImporting}>
                    <legend>Reference source</legend>
                    <p className="source-description">
                      Choose a document or a link. Only the selected source is used for this check.
                    </p>
                    <div className="source-options">
                      <label>
                        <input
                          type="radio"
                          name="source-mode"
                          value="document"
                          checked={sourceMode === 'document'}
                          onChange={() => setSourceMode('document')}
                        />
                        <FileText size={16} /> Upload document
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="source-mode"
                          value="link"
                          checked={sourceMode === 'link'}
                          onChange={() => setSourceMode('link')}
                        />
                        <Link2 size={16} /> Add a link
                      </label>
                    </div>
                  </fieldset>
                  <div hidden={sourceMode !== 'document'}>
                    <SourceDocument
                      key={documentRevision}
                      value={documentText}
                      onChange={setDocumentText}
                      maxLength={limits.document}
                      disabled={loading}
                      onBusyChange={setDocumentImporting}
                    />
                  </div>
                  <section
                    hidden={sourceMode !== 'link'}
                    className="source-url-field"
                    aria-labelledby="source-url-label"
                  >
                    <div className="source-heading-row">
                      <div>
                        <Link2 size={17} />
                        <label id="source-url-label" htmlFor="source-url">
                          Source link
                        </label>
                      </div>
                      <span className="optional-tag">OPTIONAL</span>
                    </div>
                    <p className="source-description" id="source-url-hint">
                      Paste a link to an article, website, or readable book.
                    </p>
                    <input
                      id="source-url"
                      type="url"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      maxLength={2048}
                      disabled={loading || sourceMode !== 'link'}
                      placeholder="https://example.com/article"
                      aria-describedby="source-url-hint source-url-note"
                    />
                    <p className="context-note" id="source-url-note">
                      Tavily reads the linked page for this check. Login pages, paywalls, and book
                      previews may not expose the complete source.
                    </p>
                  </section>
                  {error && (
                    <div className="error-message" role="alert">
                      <CircleHelp size={18} />
                      <div>
                        <strong>The check couldn’t finish</strong>
                        <p>{error}</p>
                      </div>
                    </div>
                  )}
                  <div className="form-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!answerText.trim() || loading || documentImporting}
                    >
                      {loading ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <ScanLine size={17} />
                      )}
                      <span>
                        {loading
                          ? result?.status === 'loading_source'
                            ? 'Reading linked source...'
                            : result?.claims.length
                              ? result.claims.every((claim) => claim.status !== 'pending')
                                ? 'Comparing Gemini answers...'
                                : 'Checking evidence...'
                              : 'Finding statements...'
                          : 'Check answer'}
                      </span>
                      {!loading && <ArrowRight size={17} />}
                    </button>
                    <button className="example-button" type="button" onClick={tryExample}>
                      <Sparkles size={16} />
                      Try an example
                    </button>
                  </div>
                  <p className="privacy-note">
                    <ShieldCheck size={13} />
                    Your key stays on the server. Answer text is sent to Gemini for live checks.
                  </p>
                </form>
              </section>
              <StatementList
                result={result}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  requestAnimationFrame(() =>
                    document.querySelector('.evidence-detail')?.scrollIntoView({
                      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'instant'
                        : 'smooth',
                      block: 'center',
                    }),
                  );
                }}
                loading={loading}
                resultsRef={resultsRef}
              />
            </div>
            <section className="how-section" aria-label="How checking works">
              <div className="how-intro">
                <span className="eyebrow">FROM ANSWER TO EVIDENCE</span>
                <h2>
                  Confidence is good.
                  <br />A closer look is better.
                </h2>
                <span className="phase-note">
                  Evidence in context.
                  <br />
                  Confidence with perspective.
                </span>
              </div>
              <div className="steps">
                {steps.map(({ icon: Icon, title, text, active }, index) => (
                  <div className={`step ${active ? 'active' : ''}`} key={title}>
                    <div className="step-top">
                      <span className="step-icon">
                        <Icon size={21} strokeWidth={1.5} />
                      </span>
                      <span className="step-number">0{index + 1}</span>
                    </div>
                    <h3>
                      {title}
                      {active && <span className="ready-dot" aria-label="Ready" />}
                    </h3>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : route === '/history' ? (
          <HistoryPage />
        ) : route === '/stats' ? (
          <StatsPage />
        ) : route.startsWith('/shared/') ? (
          <SharedPage token={route.slice('/shared/'.length)} />
        ) : (
          <div className="page-state">
            <CircleHelp size={25} />
            <h1>That page isn’t here.</h1>
            <a className="primary-button" href="#/">
              Back to your workspace
              <ArrowRight size={15} />
            </a>
          </div>
        )}
        <div className="honesty-note">
          <ShieldCheck size={16} />
          <p>
            This tool can also make mistakes.{' '}
            <span>Use it as a second look, and review important information yourself.</span>
          </p>
        </div>
      </main>
      <footer className="site-footer">
        <div>
          <Logo small />
          <span>Hallucination Visualizer</span>
        </div>
        <span>A little curiosity goes a long way.</span>
        <a
          href="#/"
          onClick={(event) => {
            if (isWorkspace) {
              event.preventDefault();
              document.getElementById('answer')?.focus();
              document
                .getElementById('answer')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
          aria-label="Back to answer input"
        >
          Back to your answer <ArrowDown size={13} className="back-arrow" />
        </a>
      </footer>
      {guide && <ReadingGuide onClose={closeGuide} />}
    </>
  );
}

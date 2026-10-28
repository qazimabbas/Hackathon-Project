import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CircleHelp,
  Clock3,
  FileText,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import ResultView, { TrustMap } from './Results.jsx';

const date = (value) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
function useApi(path) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || 'This page could not be loaded.');
        return body;
      })
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            loading: false,
            error:
              error instanceof TypeError || error instanceof SyntaxError
                ? 'Could not reach the app server. Start npm run dev and try again.'
                : error.message,
          });
      });
    return () => controller.abort();
  }, [path, version]);
  return { ...state, retry: () => setVersion((value) => value + 1) };
}
function ApiState({ loading, error, retry }) {
  if (loading)
    return (
      <div className="page-state" role="status">
        <LoaderCircle className="spin" size={25} />
        <h2>Bringing things into focus...</h2>
      </div>
    );
  if (error)
    return (
      <div className="page-state" role="alert">
        <CircleHelp size={25} />
        <h2>This page needs another try.</h2>
        <p>{error}</p>
        <button className="secondary-button" onClick={retry}>
          <RefreshCw size={14} />
          Try again
        </button>
      </div>
    );
  return null;
}
function PageIntro({ eyebrow, title, text, icon: Icon }) {
  return (
    <div className="page-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <span className="page-intro-icon">
        <Icon size={30} strokeWidth={1.3} />
      </span>
    </div>
  );
}
export function HistoryPage() {
  const [page, setPage] = useState(1);
  const state = useApi(`/api/checks?page=${page}`);
  return (
    <section className="extra-page">
      <PageIntro
        eyebrow="A SECOND LOOK, SAVED"
        title="Your past checks."
        text="Pick up a previous answer and follow its evidence again."
        icon={Clock3}
      />
      <ApiState {...state} />
      {state.data?.privateWorkspace && (
        <p className="context-note">
          Your hosted history is private to this browser. Clearing site cookies starts a new
          history. Use Share result to give someone access to a specific result.
        </p>
      )}
      {!state.loading &&
        !state.error &&
        (state.data?.checks.length ? (
          <>
            <div className="history-heading">
              <span>
                {state.data.total} saved {state.data.total === 1 ? 'check' : 'checks'}
              </span>
              <button className="reset-button" onClick={state.retry}>
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>
            <div className="history-list">
              {state.data.checks.map((check) => (
                <a href={`#/checks/${check.id}`} key={check.id} className="history-card">
                  <span className="history-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <div className="history-card-top">
                      <span>{date(check.createdAt)}</span>
                      <span>{check.overallSummary.total} statements</span>
                    </div>
                    <h2>{check.question || check.answerText.slice(0, 110)}</h2>
                    <p>
                      {check.answerText.slice(0, 180)}
                      {check.answerText.length > 180 ? '…' : ''}
                    </p>
                    <TrustMap check={check} mini />
                    <div className="history-counts">
                      <span>✓ {check.overallSummary.High} High</span>
                      <span>! {check.overallSummary.Medium} Medium</span>
                      <span>? {check.overallSummary.Low} Low</span>
                    </div>
                  </div>
                  <ArrowUpRight size={18} />
                </a>
              ))}
            </div>
            <div className="pagination">
              <button
                className="secondary-button"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                <ArrowLeft size={14} />
                Previous
              </button>
              <span>
                Page {page} of {Math.max(1, Math.ceil(state.data.total / 20))}
              </span>
              <button
                className="secondary-button"
                disabled={page * 20 >= state.data.total}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
                <ArrowRight size={14} />
              </button>
            </div>
          </>
        ) : (
          <div className="page-state">
            <Clock3 size={28} />
            <h2>A fresh start.</h2>
            <p>
              Your completed live checks will appear here. The saved example stays separate from
              your history.
            </p>
            <a className="primary-button" href="#/">
              Check an answer
              <ArrowRight size={15} />
            </a>
          </div>
        ))}
    </section>
  );
}

function TrendChart({ trend }) {
  const max = Math.max(1, ...trend.map((day) => day.claims));
  const width = 800,
    height = 200,
    padding = 28;
  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${width} ${height + 35}`}
        role="img"
        aria-label="Daily number of checked statements by trust level over the last 30 days"
      >
        <title>Daily checked statements, last 30 days. Dates use Asia/Karachi.</title>
        {[0, 0.5, 1].map((fraction, index) => (
          <g key={index}>
            <line
              x1={padding}
              y1={height - fraction * (height - 25)}
              x2={width - 10}
              y2={height - fraction * (height - 25)}
              className="chart-grid"
            />
            <text x="3" y={height - fraction * (height - 25) + 4} className="chart-axis">
              {Math.round(max * fraction)}
            </text>
          </g>
        ))}
        {trend.map((day, index) => {
          const slot = (width - padding - 15) / Math.max(1, trend.length);
          const barWidth = Math.min(42, slot * 0.55);
          const x = padding + slot * index + (slot - barWidth) / 2;
          let y = height;
          return (
            <g key={day.date}>
              <title>
                {day.date}: {day.High} High, {day.Medium} Medium, {day.Low} Low
              </title>
              {['High', 'Medium', 'Low'].map((level) => {
                const h = (day[level] / max) * (height - 25);
                y -= h;
                return (
                  <rect
                    key={level}
                    data-level={level}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    rx="2"
                  />
                );
              })}
              {(trend.length <= 8 || index % Math.ceil(trend.length / 6) === 0) && (
                <text
                  x={x + barWidth / 2}
                  y={height + 22}
                  textAnchor="middle"
                  className="chart-axis"
                >
                  {new Intl.DateTimeFormat(undefined, {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(`${day.date}T12:00:00Z`))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="chart-data">
        <summary>View chart as a table</summary>
        <div className="table-scroll">
          <table>
            <caption>Daily statement counts, Asia/Karachi</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">High</th>
                <th scope="col">Medium</th>
                <th scope="col">Low</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>{day.High}</td>
                  <td>{day.Medium}</td>
                  <td>{day.Low}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
export function StatsPage() {
  const state = useApi('/api/stats');
  const data = state.data;
  return (
    <section className="extra-page">
      <PageIntro
        eyebrow="THE BIGGER PICTURE"
        title="A pattern of clarity."
        text="See what your completed checks have revealed over time."
        icon={BarChart3}
      />
      <ApiState {...state} />
      {!state.loading && !state.error && data && (
        <>
          <div className="stat-cards">
            <div>
              <span>Completed checks</span>
              <strong>{data.checks.toLocaleString()}</strong>
              <p>Saved in your workspace</p>
            </div>
            <div>
              <span>Statements reviewed</span>
              <strong>{data.claims.toLocaleString()}</strong>
              <p>Small facts, brought into focus</p>
            </div>
            <div>
              <span>Look reliable</span>
              <strong>
                {data.High.toLocaleString()}
                <small> / {data.claims.toLocaleString()}</small>
              </strong>
              <p>High trust, backed by evidence</p>
            </div>
          </div>
          <section className="stats-panel">
            <div className="stats-panel-heading">
              <div>
                <span className="eyebrow">THE BALANCE OF EVIDENCE</span>
                <h2>Where your statements stand</h2>
              </div>
              <span>{data.claims} statements</span>
            </div>
            <div className="distribution-bar">
              {['High', 'Medium', 'Low'].map((level) => (
                <span key={level} data-level={level} style={{ flexGrow: data[level] || 0 }} />
              ))}
            </div>
            <div className="distribution-labels">
              {['High', 'Medium', 'Low'].map((level, index) => (
                <div key={level}>
                  <span className="trust-badge" data-level={level}>
                    {['✓', '!', '?'][index]} {level} trust
                  </span>
                  <strong>
                    {data.claims ? Math.round((data[level] / data.claims) * 100) : 0}%
                  </strong>
                  <span>{data[level]} statements</span>
                </div>
              ))}
            </div>
          </section>
          <section className="stats-panel">
            <div className="stats-panel-heading">
              <div>
                <span className="eyebrow">A LITTLE PERSPECTIVE</span>
                <h2>Statements over time</h2>
              </div>
              <span>Last 30 days</span>
            </div>
            {data.trend.length ? (
              <TrendChart trend={data.trend} />
            ) : (
              <p className="stats-empty">Complete your first check to start seeing a pattern.</p>
            )}
            <div className="chart-legend">
              <span>✓ High trust</span>
              <span>! Medium trust</span>
              <span>? Low trust</span>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

export function SharedPage({ token }) {
  const state = useApi(`/api/shared/${encodeURIComponent(token)}`);
  const [selectedId, setSelectedId] = useState(null);
  return (
    <section className="extra-page">
      <PageIntro
        eyebrow="A SECOND LOOK, SHARED"
        title="Follow the evidence."
        text="A read-only snapshot of a completed check. The full source document is kept private."
        icon={FileText}
      />
      <ApiState {...state} />
      {!state.loading && !state.error && state.data?.check && (
        <>
          <div className="shared-caption">
            Checked {date(state.data.check.createdAt)}. Sources and this tool can make mistakes.
          </div>
          <ResultView
            check={state.data.check}
            selectedId={selectedId || state.data.check.claims[0]?.id}
            onSelect={setSelectedId}
            readOnly
          />
        </>
      )}
    </section>
  );
}

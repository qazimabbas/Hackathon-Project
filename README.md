# Hallucination Visualizer

See which parts of an AI answer are real and which parts may be made up.

A complete JavaScript MERN app with React, Vite, Express, Mongoose, MongoDB Atlas, Gemini, Wikipedia, optional Tavily, and Server-Sent Events. No Python services.

## Run locally

Requires Node.js 22.12 or newer and npm. Dependencies and private settings are already configured on this computer.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API listens at **http://127.0.0.1:3001**.

For a fresh checkout, run `Copy-Item .env.example .env` and fill in `GEMINI_API_KEY` and `MONGODB_URI`. `TAVILY_API_KEY` is optional because Wikipedia works without a key. Keep credentials only in the ignored project-root `.env`. Never use a `VITE_` variable for a secret. Restart the development process after changing `.env`.

## Try it

1. Click **Try an example** to load an Apollo 11 answer with two planted mistakes and a short source document. No API or database connection is needed.
2. See the summary gauge and trust map above the answer. High, Medium, and Low have text labels, icons, and patterns as well as colors.
3. Choose a highlighted statement or map segment to compare it with an exact source quote. Shared words are emphasized.
4. Choose **Gemini agreement** to see **Gemini answer agreement** across five fresh answers. This supplementary consistency signal does not affect trust labels or measure the original model's consistency. The saved example explicitly labels its curated evidence and simulated repetitions.
5. Paste your own answer and add its original question if available. In the visible **Source document** section, paste reference text or choose a PDF, Word (`.docx`), text (`.txt`), or Markdown (`.md`) file. Review the extracted text, then click **Check answer** for live analysis.
6. Use **History** to reopen saved checks and **Stats** to see totals, trust distribution, and daily trends.
7. On a saved live result, choose **Share result** to copy a read-only link. Shared results omit the full source document but retain cited evidence. A localhost link works on this computer; other people need access to a hosted instance.

The example is bundled into the frontend and works without internet while the local app is running. It also works in an already-loaded page when the API fails. Fonts have local fallbacks. The demo does not alter history or statistics.

Document import reads files in the browser using PDF.js and Mammoth. It does not upload the original file or require Cloudinary. Only the extracted text enters the existing check, where Gemini analyzes it and Atlas can save it with the result. Files must be smaller than 10 MB and extracted text must fit the configured source limit (60,000 characters by default). Scanned image PDFs need OCR first, password-protected PDFs need an unlocked copy, and older `.doc` files should be saved as `.docx`. Failed imports keep the existing source text intact.

Choose **Upload document** or **Add a link** under **Reference source**. Only the selected source is submitted; switching preserves your drafts. The API rejects requests containing both a nonempty document and a link. With neither supplied, public-source search remains available.

The **Source link** field accepts a public HTTP(S) article, website page, or readable book/chapter URL. Tavily Extract reads that specific page once per check. Both evidence judgments and the five fresh answers use that page. Failed extraction produces a clear error instead of replacing the link with unrelated web search results. URL checks always read the page afresh, because its content can change. A login, paywall, book cover, or preview does not establish access to the full book. Pages exceeding the configured source limit are rejected rather than silently truncated. Full extracted text stays private in Atlas; shared results retain the URL and cited evidence while omitting the full text.

**Evidence unavailable** (previously “Check incomplete”) means a source service or evidence model could not finish, not that the wording was disproved. Such statements remain unrated, even when all five fresh answers agree. Known failures retain a safe diagnostic code. Malformed or unfinished judgments receive one fresh attempt. If the primary evidence model is rate-limited, unavailable, or unreachable, the configured fallback model tries the same source-grounded assessment. Its citations and arithmetic receive the same server checks, and the result shows a fallback notice. A genuine change of demographic scope or meaning can still receive Medium or Low trust with a reason.

## How checks work

- **Extract:** Gemini returns strict JSON with at most 10 exact answer spans and complete contextual statements. Terse bullet answers such as “Died: About 87,000” keep their exact original highlights while verification uses a complete proposition drawn from the question and surrounding answer. These can be factual conclusions (including calculations and deductions) or a response declining to answer from insufficient source information. Invented highlight quotes, overlaps, and malformed output are rejected. Paraphrases, spelling mistakes, and equivalent numerical forms receive semantic comparison without automatically treating broader groups as identical.
- **Retrieve:** Short documents are compared whole. Long documents use local sparse word vectors, TF-IDF weighting, and cosine similarity to select four relevant overlapping passages. This does not use an external embedding API. Without a document, the server retrieves Wikipedia and optional Tavily sources.
- **Judge:** A separate Gemini judge uses the original question to assess direct support, paraphrases, valid deductions, and calculations from source facts. The conclusion need not appear literally in the document. Every quoted premise must occur verbatim in its source. URLs come from retrieval, never from the judge.
- **Calculate:** For derived numerical claims, the judge supplies quoted input values and a restricted arithmetic expression. The server checks each number against its quoted source, evaluates the expression itself without executing model code, and compares the answer at its stated decimal precision. Wrong arithmetic gives Low trust even if the model calls it supported. Unverifiable calculations remain uncertain. The calculator supports addition, subtraction, multiplication, division, parentheses, and percentage constants; units and premise interpretation still depend on the judge.
- **Assess abstentions:** A response such as “I cannot calculate profit from this document” receives a separate answerability check using the original question and **complete document**. A missing necessary fact can justify the response without an impossible quote proving absence. If the document provides enough information, including through a calculation, declining to answer can be contradicted. Without the original question and document, this assessment remains uncertain. Generic opinions and unrelated policy refusals do not become factual checks.
- **Gemini answer agreement:** Gemini answers the original question five times. With a document or link, every generation uses that source and must reason only from its facts, calculating or declining to answer as appropriate. Without a supplied source, generations use the question and model knowledge. Neither mode includes the answer being checked. Missing questions are inferred with a warning. Agreement compares meaning, equivalent calculations, and equivalent abstentions. Explicit conflicts count as disagreement; omitted claims and unavailable generations stay unknown. Five generations of one model are not independent experts. Gemini can consistently repeat an error or fail to reproduce a correct answer from a stronger model. Agreement is displayed separately and never changes the trust label.
- **Classify from evidence:** For documents, links, and Wikipedia/web sources alike, supported evidence gives High trust, contradicted evidence gives Low, and insufficient or uncertain evidence gives Medium. Grounded reasoning, independently verified arithmetic, and justified abstention from the supplied source follow these same verdicts. Missing premises and unverifiable calculations stay uncertain. Agreement of 0/5 cannot downgrade supported evidence; 5/5 cannot promote an unresolved claim or override a contradiction. Technical evidence failures remain unrated.
- **Stream:** Jobs push SSE snapshots as individual evidence assessments finish, before waiting for supplementary Gemini agreement. Pending claims shimmer. One failed claim does not stop others. Reconnecting clients receive the latest state.
- **Save:** Atlas stores completed live checks. Identical inputs reuse complete, error-free results from the past 24 hours. Cache keys include all inputs, models, source mode, claim limit, and pipeline version. History outlives the cache window.

New checks use the `evidence-only-v1` trust policy and a new cache version, so results from the previous combined policy are not reused. Previously saved checks retain their historical ratings and show an earlier-policy notice when reopened; run a new check to apply the current rules. Historical statistics retain those saved ratings.

By default, three claims are checked concurrently, repeat answers are sampled two at a time, and at most two checks run concurrently. Duplicate in-progress submissions reuse a job. Input limits, per-IP rate limits, timeouts, and bounded retries control API costs.

**This tool can also make mistakes.** Sources may be incomplete or inaccurate. Repeated answers can repeat the same unsupported information. Trust labels summarize evidence and do not guarantee truth. Review important information yourself.

## Environment

Every supported setting has a comment in `.env.example`. Secrets stay on the server and are never returned to the frontend, logged, or included in provider request URLs.

| Variable                      | Purpose and default                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`                | `gemini`. Add another adapter in `server/src/llm.js` and change this variable to switch providers.                                                                                                         |
| `GEMINI_API_KEY`              | Required for live checks. Get one from [Google AI Studio](https://aistudio.google.com/api-keys).                                                                                                           |
| `GEMINI_EXTRACT_MODEL`        | `gemini-3.5-flash-lite`, for extraction.                                                                                                                                                                   |
| `GEMINI_JUDGE_MODEL`          | `gemini-3.6-flash`, for evidence. Passed live tests after 3.8 repeatedly timed out on this setup.                                                                                                          |
| `GEMINI_JUDGE_FALLBACK_MODEL` | Optional fallback for unavailable evidence models. Blank uses `GEMINI_REPEAT_MODEL`, with the same citation and arithmetic validation.                                                                     |
| `GEMINI_REPEAT_MODEL`         | `gemini-3.5-flash-lite`, for inferred questions, repeat answers, and comparison.                                                                                                                           |
| `MONGODB_URI`                 | Private Atlas URI for history, cache, stats, and sharing.                                                                                                                                                  |
| `MONGODB_DNS_SERVERS`         | Optional comma-separated process-only resolvers. Blank uses system DNS. The user-approved local value is `1.1.1.1,8.8.8.8`, because system DNS rejected Atlas SRV lookups. Windows settings are unchanged. |
| `TAVILY_API_KEY`              | Optional web search. Blank uses free Wikipedia alone.                                                                                                                                                      |
| `PORT`                        | Backend port, default 3001.                                                                                                                                                                                |
| `CLIENT_PORT`                 | Frontend port, default 5173.                                                                                                                                                                               |
| `CLIENT_ORIGIN`               | Allowed frontend origin, default `http://127.0.0.1:5173`.                                                                                                                                                  |
| `HOST`                        | Bind address, default `127.0.0.1`.                                                                                                                                                                         |
| `MAX_ANSWER_CHARS`            | Answer limit, default 12000 JavaScript characters.                                                                                                                                                         |
| `MAX_DOCUMENT_CHARS`          | Source limit, default 60000 characters.                                                                                                                                                                    |
| `MAX_QUESTION_CHARS`          | Question limit, default 2000 characters.                                                                                                                                                                   |
| `MAX_CLAIMS`                  | Default and hard maximum 10.                                                                                                                                                                               |
| `CLAIM_CONCURRENCY`           | Simultaneous claim checks, default 3.                                                                                                                                                                      |
| `LLM_TIMEOUT_MS`              | Per-attempt timeout, default 90000 milliseconds.                                                                                                                                                           |
| `LLM_MAX_RETRIES`             | Temporary-error retries, default 2. Authentication failures are not retried.                                                                                                                               |
| `RATE_LIMIT_MAX`              | Submissions per IP/window, default 10.                                                                                                                                                                     |
| `RATE_LIMIT_WINDOW_MS`        | Default 900000 milliseconds, or 15 minutes.                                                                                                                                                                |
| `NODE_ENV`                    | Optional; defaults to development. Use production to serve a built app.                                                                                                                                    |

Model names follow the [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models). All prompts live in `server/src/prompts.js`, and responses are validated with Zod.

Live analysis sends relevant text to Gemini. Public-source checking sends claims to Wikipedia and optional Tavily. A supplied source URL is sent to Tavily Extract, and its readable text is used for source-based checks. Atlas stores full source documents and linked-page text privately; shared responses omit them, while keeping the URL and cited evidence visible.

## Test and build

```powershell
npm test
npm run build
```

The isolated backend suite checks exact offsets including emoji, malformed responses, quote validation, local retrieval, concurrency, retries, safe errors, source services, trust rules, SSE, inferred questions, caching, history, and sharing. It makes no paid API calls.

With the dev server running and Google Chrome installed:

```powershell
npm run test:browser
npm run test:documents
npm run test:links
```

Browser checks cover desktop and 390px/320px widths, the offline example with API calls blocked, trust-map navigation, evidence, agreement view, theme persistence, help, reset, network errors, history, stats, and read-only sharing. That repeatable suite uses mocked history/statistics data. Screenshots are written to ignored `.local/`.

The document check imports real text, PDF, and DOCX fixtures through the browser, checks invalid and empty files, confirms failed imports preserve existing text, and verifies extracted source text reaches the check request without paid API calls.

Optional real-service verification:

```powershell
npm run verify:connections
node scripts/live-check.mjs
node scripts/live-check.mjs --web
node scripts/verify-storage.mjs
node scripts/verify-reasoning.mjs
node scripts/verify-links-paraphrases.mjs
```

- Connection verification makes one small extraction request and a read-only Atlas ping.
- The live-check script exercises one complete claim through the running API, including five answers and SSE. It saves `.local/live-check.json`.
- Add `--web` to verify public evidence and missing-question inference instead of a supplied document.
- Storage verification uses that result to test real Atlas saving, reopening, caching, stats, and sharing. It leaves the verified result available in history.
- Reasoning verification makes real Gemini calls for correct and incorrect arithmetic, appropriate uncertainty, and unjustified abstention, including five document-based answers for each case. It writes `.local/live-reasoning-checks.json` without changing Atlas.
- Link/paraphrase verification checks contextual statements against a controlled reference, then uses real Tavily and Gemini to check a paraphrased answer against a NASA page. It saves the verified URL check to Atlas, reopens it, and verifies that sharing omits the full extracted source text.

These optional scripts use real provider quota. Cached results are reused. They print safe statuses without credentials.

### Production

Run `npm run build`, set `NODE_ENV=production` in the server environment or root `.env`, and run `npm start`. Express serves the API and `client/dist` on the backend port. Update `CLIENT_ORIGIN` to match the browser origin. Leave `NODE_ENV` unset for development and normal production build generation.

Rollup uses its official `@rollup/wasm-node` package through an npm alias and override. Windows Application Control blocked its native module on this computer; no OS policy was changed. The lockfile preserves the working setup.

This is a local, single-workspace app. History and stats belong to its configured database. If Atlas becomes unavailable, analysis may still finish but the page warns that saving failed; history/stats show retryable errors. Active jobs are in process memory. Saved completed checks survive restarts; restarting can interrupt an active check.

## API

| Route                        | Behavior                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`            | Name, phase, limits, and credential-presence flags. Presence is not proof of remote service acceptance.                             |
| `POST /api/checks`           | Accepts `{ answerText, question?, documentText?, sourceUrl? }`. Returns 202 with `{ id, check }`, or 200 with `check.cached: true`. |
| `GET /api/checks/:id/stream` | SSE snapshot events and heartbeats; closes on completion or failure.                                                                |
| `GET /api/checks?page=1`     | Saved checks, 20 per page, newest first.                                                                                            |
| `GET /api/checks/:id`        | Current or saved check.                                                                                                             |
| `GET /api/stats`             | Totals, trust counts, and 30 daily trend entries in Asia/Karachi time.                                                              |
| `GET /api/example`           | Curated demo; also bundled directly into the frontend.                                                                              |
| `POST /api/checks/:id/share` | Creates/reuses an unguessable read-only link.                                                                                       |
| `GET /api/shared/:token`     | Shared result without the full source document or internal fields.                                                                  |

Claims retain zero-based, end-exclusive JavaScript positions, source and repeat results, hits, trust, reasons, and warnings. Pending statements have no trust label. Errors never expose upstream bodies.

## Source layout

```text
client/src/
  App.jsx          Input, streaming, navigation, example, theme, help
  SourceDocument.jsx Visible source text and file import controls
  sourceDocument.js  Browser text, PDF and DOCX extraction
  Results.jsx      Map, gauge, highlights, agreement, evidence, sharing
  Pages.jsx        History, stats, shared results
  styles.css       Responsive light/dark and reduced motion
server/src/
  app.js           Routes, validation, limits, SSE, safe errors
  pipeline.js      Background jobs and progressive results
  claims.js        Validated extraction and exact positions
  evidence.js      Local document retrieval and judging
  calculation.js   Restricted arithmetic evaluation from cited inputs
  sources.js       Wikipedia, Tavily search and selected-URL extraction
  repeat.js        Five supplementary Gemini answers and comparison
  llm.js           Provider adapter, timeouts, retries
  prompts.js       All LLM prompts
  repository.js    Mongoose schema, history, cache, stats, sharing
  db.js            Atlas connections and app-only DNS
  config.js        Validated private settings
server/test/       Isolated backend tests
server/scripts/    Connection verification and DNS diagnosis
scripts/           Browser QA and explicit live checks
shared/example.js  Offline demo shared by both sides
.env.example       Commented settings without secrets
```

## Phases

| Phase | Implementation and verification                                                        |
| ----- | -------------------------------------------------------------------------------------- |
| 1     | Setup, private settings, live extraction, exact positions, Atlas ping.                 |
| 2     | Document comparisons, validated evidence quotes, colored highlights.                   |
| 3     | Wikipedia and Tavily, both verified against real searches.                             |
| 4     | Five supplementary Gemini answers, dots, inferred-question notice, live SSE.           |
| 5     | Whole-answer map, summary gauge, side-by-side evidence, agreement view.                |
| 6     | Real Atlas save/reopen/cache/stats/share verification.                                 |
| 7     | Offline demo, animations, plain labels, errors, dark mode, mobile and keyboard access. |

## Vercel deployment

The repository includes `vercel.json` and `api/index.js` for a single Vercel project that serves both the Vite frontend and Express API. Static assets are served by Vercel's CDN; `/api/*` goes to the Node function. Run the project from the repository root, not the `client` directory. Node 24 is supported by this project.

Configure `GEMINI_API_KEY`, `MONGODB_URI`, `TAVILY_API_KEY`, the desired Gemini model names, and a random `SESSION_SECRET` of at least 32 characters as private production environment variables. Set `NODE_ENV=production` and `CLIENT_ORIGIN` to the deployed origin. The deployment uses a 45-second provider timeout and one retry to fit the hosted runtime. Local Atlas DNS overrides are normally unnecessary on Vercel. Never upload `.env`, `.env.local`, or `.local`; `.vercelignore` excludes them.

Hosted submissions stream snapshots over the POST request, keeping the function invocation alive until verification and saving finish. JSON-only callers receive the completed result. Progress is stored in a separate Atlas job collection and can be read across function instances; temporary job snapshots expire after 24 hours. Completed history remains in the normal checks collection. The function has a 300-second maximum duration. Interrupted jobs are reported as timed out after that allowance; they are not automatically resumed. Provider retries, the per-instance concurrent-job limit, and per-instance IP rate limiting still apply.

On the hosted app, signed HttpOnly browser cookies isolate each visitor's saved checks, full source text, history, statistics, cache entries, and active jobs. Existing unscoped local history is not exposed to hosted visitors. Clearing cookies or using another browser creates a new workspace. Explicit share tokens remain publicly readable and omit full source text. Local development retains its existing single-workspace behavior.

Use `npx vercel login`, link the project with `npx vercel link`, configure the environment, then deploy with `npx vercel --prod`. GitHub repository integration is optional for CLI deployments; enabling it requires the Vercel GitHub application to have access to the repository.

## Troubleshooting

- Gemini: check API access, model availability, and quota, then restart after editing `.env`.
- Atlas DNS: `node server/scripts/diagnose-atlas.js` compares resolvers without changing settings. `MONGODB_DNS_SERVERS` affects only this app process.
- Atlas access: confirm the cluster is active, credentials are correct, and Atlas allows this computer's current IP.
- Saving failed: keep the result page open and check Atlas connectivity. The page displays a clear notice.
- Port occupied: stop the other app or change ports and update `CLIENT_ORIGIN`.
- Interrupted run: SSE retries broken connections. If the server restarted mid-check, begin a new check. The example remains available without remote services.

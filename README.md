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
4. Choose **Agreement view** to see five repeated-answer dots. The saved example explicitly labels its curated evidence and simulated repetitions.
5. Paste your own answer and add its original question if available. In the visible **Source document** section, paste reference text or choose a PDF, Word (`.docx`), text (`.txt`), or Markdown (`.md`) file. Review the extracted text, then click **Check answer** for live analysis.
6. Use **History** to reopen saved checks and **Stats** to see totals, trust distribution, and daily trends.
7. On a saved live result, choose **Share result** to copy a read-only link. Shared results omit the full source document but retain cited evidence. A localhost link works on this computer; other people need access to a hosted instance.

The example is bundled into the frontend and works without internet while the local app is running. It also works in an already-loaded page when the API fails. Fonts have local fallbacks. The demo does not alter history or statistics.

Document import reads files in the browser using PDF.js and Mammoth. It does not upload the original file or require Cloudinary. Only the extracted text enters the existing check, where Gemini analyzes it and Atlas can save it with the result. Files must be smaller than 10 MB and extracted text must fit the configured source limit (60,000 characters by default). Scanned image PDFs need OCR first, password-protected PDFs need an unlocked copy, and older `.doc` files should be saved as `.docx`. Failed imports keep the existing source text intact.

## How checks work

- **Extract:** Gemini returns strict JSON with at most 10 exact factual quotes. The server validates them and calculates positions by matching the original text. Invented quotes, overlaps, and malformed output are rejected.
- **Retrieve:** Short documents are compared whole. Long documents use local sparse word vectors, TF-IDF weighting, and cosine similarity to select four relevant overlapping passages. This does not use an external embedding API. Without a document, the server retrieves Wikipedia and optional Tavily sources.
- **Judge:** A separate Gemini judge decides whether passages support, contradict, or say nothing about a claim. Every evidence quote must occur verbatim in the retrieved source. URLs come from retrieval, never from the judge.
- **Repeat:** The cheaper model answers the original question five independent times, then compares each claim against those answers. These question-only prompts never include the answer being checked or its source. Missing questions are inferred, with a visible accuracy warning. Failed samples stay unknown rather than counting as disagreement.
- **Combine:** Contradicting evidence gives Low trust. Source support and at least three repeated matches give High trust. Weaker or incomplete repetition alongside support gives Medium trust. Repetition without source support never gives High trust. Without proof, weak repetition gives Low trust when enough samples completed; otherwise it remains Medium.
- **Stream:** Jobs push SSE snapshots as individual claims finish. Pending claims shimmer. One failed claim does not stop others. Reconnecting clients receive the latest state.
- **Save:** Atlas stores completed live checks. Identical inputs reuse complete, error-free results from the past 24 hours. Cache keys include all inputs, models, source mode, claim limit, and pipeline version. History outlives the cache window.

By default, three claims are checked concurrently, repeat answers are sampled two at a time, and at most two checks run concurrently. Duplicate in-progress submissions reuse a job. Input limits, per-IP rate limits, timeouts, and bounded retries control API costs.

**This tool can also make mistakes.** Sources may be incomplete or inaccurate. Repeated answers can repeat the same unsupported information. Trust labels summarize evidence and do not guarantee truth. Review important information yourself.

## Environment

Every supported setting has a comment in `.env.example`. Secrets stay on the server and are never returned to the frontend, logged, or included in provider request URLs.

| Variable               | Purpose and default                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`         | `gemini`. Add another adapter in `server/src/llm.js` and change this variable to switch providers.                                                                                                         |
| `GEMINI_API_KEY`       | Required for live checks. Get one from [Google AI Studio](https://aistudio.google.com/api-keys).                                                                                                           |
| `GEMINI_EXTRACT_MODEL` | `gemini-3.5-flash-lite`, for extraction.                                                                                                                                                                   |
| `GEMINI_JUDGE_MODEL`   | `gemini-3.6-flash`, for evidence. Passed live tests after 3.8 repeatedly timed out on this setup.                                                                                                          |
| `GEMINI_REPEAT_MODEL`  | `gemini-3.5-flash-lite`, for inferred questions, repeat answers, and comparison.                                                                                                                           |
| `MONGODB_URI`          | Private Atlas URI for history, cache, stats, and sharing.                                                                                                                                                  |
| `MONGODB_DNS_SERVERS`  | Optional comma-separated process-only resolvers. Blank uses system DNS. The user-approved local value is `1.1.1.1,8.8.8.8`, because system DNS rejected Atlas SRV lookups. Windows settings are unchanged. |
| `TAVILY_API_KEY`       | Optional web search. Blank uses free Wikipedia alone.                                                                                                                                                      |
| `PORT`                 | Backend port, default 3001.                                                                                                                                                                                |
| `CLIENT_PORT`          | Frontend port, default 5173.                                                                                                                                                                               |
| `CLIENT_ORIGIN`        | Allowed frontend origin, default `http://127.0.0.1:5173`.                                                                                                                                                  |
| `HOST`                 | Bind address, default `127.0.0.1`.                                                                                                                                                                         |
| `MAX_ANSWER_CHARS`     | Answer limit, default 12000 JavaScript characters.                                                                                                                                                         |
| `MAX_DOCUMENT_CHARS`   | Source limit, default 60000 characters.                                                                                                                                                                    |
| `MAX_QUESTION_CHARS`   | Question limit, default 2000 characters.                                                                                                                                                                   |
| `MAX_CLAIMS`           | Default and hard maximum 10.                                                                                                                                                                               |
| `CLAIM_CONCURRENCY`    | Simultaneous claim checks, default 3.                                                                                                                                                                      |
| `LLM_TIMEOUT_MS`       | Per-attempt timeout, default 90000 milliseconds.                                                                                                                                                           |
| `LLM_MAX_RETRIES`      | Temporary-error retries, default 2. Authentication failures are not retried.                                                                                                                               |
| `RATE_LIMIT_MAX`       | Submissions per IP/window, default 10.                                                                                                                                                                     |
| `RATE_LIMIT_WINDOW_MS` | Default 900000 milliseconds, or 15 minutes.                                                                                                                                                                |
| `NODE_ENV`             | Optional; defaults to development. Use production to serve a built app.                                                                                                                                    |

Model names follow the [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models). All prompts live in `server/src/prompts.js`, and responses are validated with Zod.

Live analysis sends relevant text to Gemini. Public-source checking sends claims to Wikipedia and optional Tavily. Atlas stores full source documents privately; shared responses omit them, while keeping cited evidence visible.

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
```

Browser checks cover desktop and 390px/320px widths, the offline example with API calls blocked, trust-map navigation, evidence, agreement view, theme persistence, help, reset, network errors, history, stats, and read-only sharing. That repeatable suite uses mocked history/statistics data. Screenshots are written to ignored `.local/`.

The document check imports real text, PDF, and DOCX fixtures through the browser, checks invalid and empty files, confirms failed imports preserve existing text, and verifies extracted source text reaches the check request without paid API calls.

Optional real-service verification:

```powershell
npm run verify:connections
node scripts/live-check.mjs
node scripts/live-check.mjs --web
node scripts/verify-storage.mjs
```

- Connection verification makes one small extraction request and a read-only Atlas ping.
- The live-check script exercises one complete claim through the running API, including five answers and SSE. It saves `.local/live-check.json`.
- Add `--web` to verify public evidence and missing-question inference instead of a supplied document.
- Storage verification uses that result to test real Atlas saving, reopening, caching, stats, and sharing. It leaves the verified result available in history.

These optional scripts use real provider quota. Cached results are reused. They print safe statuses without credentials.

### Production

Run `npm run build`, set `NODE_ENV=production` in the server environment or root `.env`, and run `npm start`. Express serves the API and `client/dist` on the backend port. Update `CLIENT_ORIGIN` to match the browser origin. Leave `NODE_ENV` unset for development and normal production build generation.

Rollup uses its official `@rollup/wasm-node` package through an npm alias and override. Windows Application Control blocked its native module on this computer; no OS policy was changed. The lockfile preserves the working setup.

This is a local, single-workspace app. History and stats belong to its configured database. If Atlas becomes unavailable, analysis may still finish but the page warns that saving failed; history/stats show retryable errors. Active jobs are in process memory. Saved completed checks survive restarts; restarting can interrupt an active check.

## API

| Route                        | Behavior                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`            | Name, phase, limits, and credential-presence flags. Presence is not proof of remote service acceptance.                 |
| `POST /api/checks`           | Accepts `{ answerText, question?, documentText? }`. Returns 202 with `{ id, check }`, or 200 with `check.cached: true`. |
| `GET /api/checks/:id/stream` | SSE snapshot events and heartbeats; closes on completion or failure.                                                    |
| `GET /api/checks?page=1`     | Saved checks, 20 per page, newest first.                                                                                |
| `GET /api/checks/:id`        | Current or saved check.                                                                                                 |
| `GET /api/stats`             | Totals, trust counts, and 30 daily trend entries in Asia/Karachi time.                                                  |
| `GET /api/example`           | Curated demo; also bundled directly into the frontend.                                                                  |
| `POST /api/checks/:id/share` | Creates/reuses an unguessable read-only link.                                                                           |
| `GET /api/shared/:token`     | Shared result without the full source document or internal fields.                                                      |

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
  sources.js       Wikipedia and optional Tavily
  repeat.js        Five answers and trust rules
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
| 4     | Five answers, dots, inferred-question notice, combined trust, live SSE.                |
| 5     | Whole-answer map, summary gauge, side-by-side evidence, agreement view.                |
| 6     | Real Atlas save/reopen/cache/stats/share verification.                                 |
| 7     | Offline demo, animations, plain labels, errors, dark mode, mobile and keyboard access. |

## Troubleshooting

- Gemini: check API access, model availability, and quota, then restart after editing `.env`.
- Atlas DNS: `node server/scripts/diagnose-atlas.js` compares resolvers without changing settings. `MONGODB_DNS_SERVERS` affects only this app process.
- Atlas access: confirm the cluster is active, credentials are correct, and Atlas allows this computer's current IP.
- Saving failed: keep the result page open and check Atlas connectivity. The page displays a clear notice.
- Port occupied: stop the other app or change ports and update `CLIENT_ORIGIN`.
- Interrupted run: SSE retries broken connections. If the server restarted mid-check, begin a new check. The example remains available without remote services.

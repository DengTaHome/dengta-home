# DengTa Home — System Design Specification

Status: revised after Goldfish review (`goldfish_review_report.md`)
Date: 2026-10-27
Baseline: repository HEAD `766e47c`, backend version `0.29.28`

## Reading this document

Two different artifacts are involved and they are **not the same code**:

| Artifact | Version | Where it is |
| --- | --- | --- |
| This repository | `0.29.28`, HEAD `766e47c` (2026-10-18) | the code you can read |
| The production deployment | `0.29.76`, commit `0250f7b8` | only reachable over the network; that commit is not in this repository |

Every claim below was measured against **the repository**, not production. Where production differs, it is labelled. The earlier draft of this document mixed the two, which produced two identifiers that do not exist in this codebase at all.

---

## 1. Root problem

One person wants a private, self-hosted AI companion. They own the deployment, the data, and the model credentials. The product must keep a relationship continuous across sessions: the companion remembers, has mood, and shares activities. It runs as a web app, an installable PWA, and an Android app, and one owner must be able to operate it without an ops team.

Non-goals: multi-owner SaaS with billing, horizontal scale beyond one Node process, offline local inference.

---

## 2. Deployment shape

| Piece | Host | Responsibility |
| --- | --- | --- |
| `frontend/` | Vercel (static) | React 19 SPA, PWA, and the same build is shipped inside the Android app |
| `backend/` | Render (Node 24, one instance, `plan: free`) | Express 5 API, provider calls, background job execution |
| Supabase | Managed | Auth (GoTrue), Postgres, Storage |
| kiwi-mem | Optional, separate repository | External memory gateway (Python + Postgres/pgvector) |

Deployment configuration lives at `backend/render.yaml` and `frontend/vercel.json`; `docs/DEPLOYMENT.md` is the operating procedure and `backend/.env.example` is the authoritative variable list. This document does not restate them.

### 2.1 Entry points and their authentication

| Entry | Identity | Protection |
| --- | --- | --- |
| `/api/**`, `/settings`, `/sessions`, `/chat` | user JWT | `auth-context.js` middleware |
| `/internal/background-jobs/tick` | none | `BACKGROUND_JOB_TRIGGER_SECRET`, mounted **before** the auth middleware (`server.js:578`) |
| `/api/push/*` | none | `PUSH_SECRET` |
| device/installation requests | installation token | `x-dengta-installation-token` path allowlist (`auth-context.js:159-273`) |
| `/health` | none | deliberately public, bypasses auth (`server.js:5138`) |

So there are four distinct trust paths, not one. "Everything privileged happens server-side" is true for data, but three of these entries carry no user identity by design.

### 2.2 First-run blockers

- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are mandatory; the process calls `process.exit(1)` without them (`server.js:370-373`).
- `auth-context.js:37-39` rejects any user whose `email_confirmed_at` is unset (403 `email_not_verified`). Supabase email confirmation must be enabled, and the owner must confirm, or nobody can log in.
- `AUTH_REQUIRED` defaults to `NODE_ENV === "production"` (`server.js:365-368`), but `backend/.env.example:4` ships `false`. A self-hoster who copies the example gets an anonymous, writable API.

### 2.3 Single instance is a contract, not a coincidence

`render.yaml` declares `plan: free`, so one instance. The background-job lease layer is already multi-instance safe: `for update skip locked` claiming (`014_background_job_leases.sql:103`), a partial unique index guarding recurring jobs (`015:6-17`), and lease heartbeat with lost-lease detection (`background-job-worker.js:95-150`).

What actually breaks at two instances is process-local state: the in-memory rate limiters (voice 6/min, TTS 12/min, weather 30/10min), the 24-entry / 25 MB TTS cache, and one `setInterval` per instance. Those are the only hard constraints on scaling out.

---

## 3. Tenancy

### 3.1 Shape and ownership convention

79 tables in `public`. Most rows belong to a `user_id` plus a `companion_id`; a user may own several companions, and each companion has its own conversations, memories, diary, moments and mood state.

The convention is exact, not approximate: **the ownership columns must be named `user_id` and `companion_id`**, because the scoped client filters on those literal names. Two exceptions exist and both are deliberate:

- `user_profiles` is keyed by `id` (it is the account row, not a tenant row).
- Co-watch and watch-session tables use `host_user_id` / `host_companion_id`, because a room belongs to a host and has participants from other tenants.

Attempting to route either exception through the scoped client fails — see 3.2.

### 3.2 How tenancy is actually enforced: a fail-closed whitelist

`services/request-scope.js:17-91` holds `TABLE_SCOPES`, a **73-entry whitelist**. `scope.db.from(table)` for anything outside it throws `RequestScope does not allow unscoped table` (`:93-97`). Each entry declares:

- `kind`: `"user"` (filter by `user_id`) or `"profile"` (filter by `id`);
- `companion`: whether a `companion_id` filter is also applied;
- `upsert`: allowed for exactly four tables (`:155-171`);
- RPC: a four-name allowlist that injects `p_user_id` / `p_companion_id` (`:173-190`).

`requireRequestScope(req)` throws 401 when `req.scope` is absent (`:293-302`).

**13 tables sit outside the whitelist by design**: `co_watch_rooms`, `co_watch_room_participants`, `co_watch_room_messages`, `co_watch_room_memories`, `companion_acquaintances`, `companion_slot_codes`, `device_events`, `interest_profiles`, `music_queue_operation_requests`, `user_display_ids`, `watch_events`, `watch_receipts`, `watch_viewings`. They are reached through services that take the raw database plus the scope and validate membership themselves (`requireRoomParticipant` in `services/co-watch-rooms.js`).

The practical consequence: this is not a loose convention where a missed filter leaks data. It is fail-closed by construction. The risk surface is the **enumerable set of tables allowed to bypass it**, not the possibility of a forgotten `.eq()`.

### 3.3 Where it is violated

`server.js` contains 17 occurrences of `req.scope?.db || supabase` (lines 5264, 5316, 5357, 5374, 5392, 5418, 5473, 5512, 5539, 5586, 5595, 5611, 5654, 5869, 5951, 6022, 6304). The fallback uses the unscoped admin client.

`requireRequestScope` is called 225 times across 32 files; only 8 of those call sites are in `server.js` (609, 627, 644, 656, 671, 724, 5630, 6403). So the strict path is the norm, and the 17 fallbacks are a known, enumerable legacy list — not an architectural split.

When `AUTH_REQUIRED=false` and no token is present, the middleware calls `next()` **without setting a scope** (`auth-context.js:318-321`), so those 17 routes are reachable anonymously, including `GET /sessions/:id/messages`, which has neither `limit` nor cursor (`server.js:5510-5525`).

### 3.4 The database layer, stated correctly

Two independent layers exist. Conflating them hides the only dangerous combination.

**GRANT layer** — decides whether a role may touch the table at all. `grant select` appears only in `012:1178-1188` (11 tables), `055:36` and `056:31`. This, not RLS, is why the majority of tables are unreadable by `anon` / `authenticated`.

**RLS layer** — decides which rows. Measured on a replayed database at this baseline (after `063_rls_hardening.sql`):

| Metric | Value |
| --- | --- |
| Tables in `public` | 79 |
| With RLS enabled | 79 |
| With at least one policy | 19 |
| Policies total (public / whole database) | 26 / 27 |
| With RLS but no policy | 60 |
| Policies permitting writes | 11, across 7 tables |

The seven tables with write policies are `memory_calendar`, `bilibili_qr_sessions`, `ai_music_play_requests`, `whereabouts_points`, `whereabouts_state`, `timeline_taxonomy`, `timeline_days`.

Because the backend connects with `service_role` (`bypassrls`), RLS provides no defence against the backend at all. It only constrains a hypothetical browser-side data path, and **that path does not exist**: `frontend/src` contains zero `.from(` calls and builds an auth-only GoTrue client (`auth-session.js:16`). RLS is therefore inert by design, not by accident.

### 3.5 The gap that was closed

`achievements`, `user_achievements`, `special_dates`, `xhs_connections`, `daily_shots`, `interest_profiles`, `watch_events`, `compatibility_records` previously had **zero** `enable row level security`, zero `create policy`, and zero `grant`/`revoke` anywhere in the migration tree — their reachability depended entirely on Supabase project-level default privileges, which this repository neither set nor revoked.

`063_rls_hardening.sql` closes it: those eight now have RLS enabled and all privileges revoked from `anon` and `authenticated`. With no policy present, RLS denies everything to those roles, while `service_role` continues to work unchanged. All 79 tables now have RLS enabled; none is undeclared.

---

## 4. Chat pipeline

### 4.1 Request lifecycle

A turn lives almost entirely in `server.js`:

1. `POST /chat/stream` → auth middleware → `requireRequestScope`.
2. `normalizeChatRequest` (`:1815`) validates; `loadChatContext` (`:3269`) loads settings, prompt fields, memory and recent history.
3. `executeChatTurn` (`:5090`) → `chat-idempotency.js:252` `runClientMessageTask` → `executeChatTurnOnce` (`:4404-5088`, ~680 lines) owns the lease, attachment lifecycle, memory assembly, prompt construction, persistence and refusal logging.
4. `services/ai-service.js` performs provider transport only (`generateReply` `:3779`, `generateReplyStream` `:4126`).
5. Errors surface as typed codes (`provider_stream_incomplete`, `context_budget_exceeded`, …) mapped to human text in `frontend/src/chat-errors.js`.

Identity comes from the `X-DengTa-Companion-Id` header. `ensureAccount` (`auth-context.js:41-149`) falls back to `is_default`, then `companions[0]`, creating "我的伴侣" on first login; a malformed id is 400 `invalid_companion_id`, a foreign one 404 `companion_not_found`.

### 4.2 Prompt composition

Not "independently versioned layers". `settings.prompt_mode` is either `legacy` (three columns concatenated) or `unified` (`unified_system_prompt`), a two-way branch at `ai-service.js:351-361`. `011_unified_prompt_architecture.sql` performs a one-time concatenation of the legacy columns.

Memory limits are two different numbers and both matter: at most 12 memories per turn with a 5,000-character cap each, plus a separate 6,000-character budget (`memory-budget.js:1`). A character budget is not a token budget: 6,000 characters is roughly 6,000–9,000 tokens in Chinese and 1,500–2,000 in English, so the same configured value constrains different users very differently.

### 4.3 Reliability and cost

- **No cancellation.** Nothing listens for `res.on("close")`; `AbortController` is used only for a 300 s timeout (`ai-service.js:1612-1617`). A mobile disconnect therefore lets the upstream generation finish and persist, invisible to the client. `media-stream-relay.js:8-9` already implements close propagation for media — the chat path does not.
- **Unbounded output.** `max_tokens <= 0` disables the cap (`ai-service.js:156-158`).
- **Retry.** Two attempts total with a fixed 250 ms delay (`:1861`, `:69`).
- **Rate limiting.** None on `/chat` or `/chat/stream`. The only limiters are voice (`:2810`), expressive TTS (`:6339`) and weather.
- **Body parsing.** `express.json({ limit: "30mb" })` is mounted at `:579`, **before** authentication at `:597`. Any path, with no credentials, parses a 30 MB body. On one free-tier instance this is an availability attack, not a token-spend attack.
- **Per-instance limiters.** All limiters are in-process maps, so the effective quota scales with instance count. `app.set("trust proxy", 1)` (`:361`) decides what `req.ip` means for those keys.

---

## 5. Client

`main.jsx` imports 14 global stylesheets, registers a service worker, branches to an unauthenticated `ReceiverApp` on `/receive`, and loads the application through `main → LoadedApp → LazyApp → App`.

`App.jsx` is 9,588 lines with 120 `useState`, 43 `useEffect` and 1 `useMemo`. All feature state lives in the root. Consequences worth naming:

- Any render-time exception blanks the entire application; there is one error boundary.
- A keystroke re-renders the tree. `Entry` in `ChatTranscript.jsx:7` is memoized, but the inline callbacks it receives are recreated each render, so the memo does not hold. (`ChatTranscript` itself is **not** memoized — an earlier draft of this document claimed otherwise.)
- History is fetched without a cursor from at least five call sites, and `inner-monologue-sync.js:83` fetches the same history a second time. For a product sold on long-term memory, "longer history makes the UI slower" is a product defect rather than a performance nit.
- The 495 KB `App` chunk is outside `initial-bundle-budget.test.js`, which follows static `imports` only. Whether to count the dynamic chunk is a product decision, but the current budget cannot see the largest asset.

Android is a Capacitor shell around the same build (`compileSdk 36`, `minSdk 31`). Release signing material is deliberately absent.

---

## 6. Failure domains

| Domain | Actual behaviour |
| --- | --- |
| Supabase unreachable (observed: `*.supabase.co` refused at TLS) | Login fails at the auth gate; `/health` is unaffected, because it queries nothing |
| `/health` | Returns `ok/time/version/revision/features`. The ~60-entry `features` map is **hardcoded constants**, not runtime state. It is a liveness endpoint only, and `render.yaml` uses it as `healthCheckPath` |
| `/api/v2/health/deep` | Authenticated. Performs one real database round-trip (`settings` head query), returns 200 or **503** with `database: ok\|error`, latency, and the upstream message. Cached 60 s so a 10-second monitor hits the database once a minute |
| Background jobs | `BACKGROUND_JOBS_ENABLED` is `false` in `render.yaml` and in `.env.example:12`. The tick is driven by `.github/workflows/background-jobs.yml` (`*/10 * * * *`) when enabled. Mood evolution, proactive messages and diary writes do not run in the shipped configuration |
| Provider refusal or timeout | Typed error, mapped in the client, turn not persisted |
| Postgres error | 500 with `database_error`; `/health` cannot see it, `/api/v2/health/deep` can |
| Client disconnects | Generation continues and is billed |
| GitHub Actions cron stops (repository inactive) | Background behaviour silently stops while `/health` still reports `ok: true` |

The monitoring consequence is explicit: **there is no unauthenticated way to ask whether this deployment can serve data**, and that is deliberate. `/api/v2/health/deep` is the signal to alert on; a public database probe would be a free load generator.

---

## 7. Migrations and verification

68 SQL files, applied by hand, with no `schema_migrations` ledger. Prefixes `046`–`050` are duplicated; `docs/DEPLOYMENT.md:12` already documents that numeric order alone does not establish dependency order and that files must not be blindly reapplied.

What is verified today:

| Check | Command | In CI |
| --- | --- | --- |
| Backend tests (273) | `cd backend && npm test` | yes |
| Frontend tests (1,584) | `cd frontend && npm test` | yes |
| Typecheck, lint, build | `npm run typecheck` / `lint` / `build` | yes |
| Prompt-architecture guard | `npm run check:prompt-architecture` | yes |
| **All 69 migrations replay** | `cd backend && npm run audit:migrations` | **yes** (`.github/workflows/ci.yml`) |
| Real-Postgres replay | `_tools\replay-pg.ps1` (workspace) | no |

`multitenant-pglite.test.mjs:80` replays only the first 12 migrations, so it never covered 013–063 on its own. That gap is now closed in CI by the replay script, which builds all 69 migrations into an embedded database on every push.

---

## 8. Decisions

Each row states the option, what choosing it costs, what not choosing it costs, and who decides.

| # | Decision | Choose this | Cost of choosing | Cost of not choosing | Decider | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Add RLS + `revoke` to the eight bare tables | Yes | two statements × 8 tables | eight tables readable wholesale if project defaults ever grant | Owner | **done** (`063_rls_hardening.sql`) |
| 2 | Remove the 17 admin-client fallbacks | **Rejected by the owner** | — | anonymous write path remains reachable when `AUTH_REQUIRED=false` | Owner | **rejected** — see §8.1 |
| 3 | Change `AUTH_REQUIRED=false` default in `.env.example` | Yes | one line | self-hosters ship an open API | Owner | **done** (now `true` with an explanation) |
| 4 | Count the `App` chunk in the bundle budget | Owner's call | may force code splitting sooner | the budget cannot see the largest asset | Owner | open |
| 5 | Wire `audit:migrations` into CI | Yes | one line in `ci.yml` | 63 migrations never built before deploy | Owner | **done** |
| 6 | Add a `schema_migrations` ledger | Defer to the second deployment | one table + a runner | re-apply risk is documented but unenforced | Owner | deferred |
| 7 | Public database probe on `/health` | No — an authenticated `/api/v2/health/deep` instead | one small route | no external data-path signal | Owner + operator | **done** |
| 8 | Cancel upstream generation on client disconnect | **Rejected by the owner** | — | abandoned streams are still billed | Owner | **rejected** — see the delivery contract below |

### 8.1 The 17 admin-client fallbacks are intentional (owner decision)

The Goldfish review flagged `req.scope?.db || supabase` (17 occurrences, all in `server.js`) as a defect and recommended replacing each with `requireRequestScope`. **The owner rejected that.**

The reason is operational, not architectural: those fallbacks are what makes the no-auth local mode usable. Removing them turns `/sessions`, `/settings`, `/models`, `/database-test` and the rest into hard 401s, and local debugging then needs a real token for every probe.

So the fallbacks stay. What follows from keeping them:

- They are only reachable when `AUTH_REQUIRED` is false, because the auth middleware responds 401 before routing otherwise. Production sets `AUTH_REQUIRED=true` (`render.yaml`), so this path is a development affordance.
- `.env.example` now ships `AUTH_REQUIRED=true` so a self-hoster does not get an anonymous API by copy-paste; switching it back to `false` is a deliberate local-only choice.
- `GET /sessions/:id/messages` still has no limit or cursor, and in no-auth mode it is reachable anonymously. That is a known, accepted consequence of this decision — not an oversight.

A future reader should not "fix" these 17 sites without an explicit product decision.

### 8.2 Delivery contract for generated text (owner decision, overrides the review)

The Goldfish review recommended cancelling upstream generation when the client disconnects (finding F-12). **The owner rejected that.** The governing requirement is the opposite:

1. **Every generated character is displayed immediately.** No buffering the reply until it completes, no "generate then send".
2. **Nothing is retracted.** Text that has been shown stays shown; the stream is append-only.
3. **Whatever has been generated is persisted as it is generated**, not only on completion.
4. **Upstream generation is not cancelled** on disconnect.

Consequences that follow from this, and are therefore design constraints rather than bugs:

- Streaming must stay append-only; any server-side filter may delay at most a short bounded window, never until completion. The control-token scrubber's holdback is capped at 120 characters for exactly this reason.
- Partial replies are legitimate persisted state. A turn interrupted by a disconnect leaves a partial assistant message, and that is intended.
- The F-12 finding stays open only in the sense of cost: abandoned streams are billed. The owner accepts that cost in exchange for immediacy.

**Implemented for this contract:** `064_stream_partials.sql` plus `services/stream-persistence.js`. During generation the accumulated text is upserted every ~200 characters or 750 ms (whichever comes first) without blocking the stream. After the real message commits, the buffer row is deleted. `GET /sessions/:id/messages` now returns an extra top-level `streaming_partial` field when a fresh buffer row exists, so a client that reloads mid-generation can render what was already produced. Rows older than ten minutes are treated as abandoned and removed. The client-side rendering of `streaming_partial` is not wired yet.

### 8.3 Output filtering is already off by default

An earlier report in this session implied that provider output is filtered. It is not. `ai-service.js:4165-4170` reads:

```js
const providerOutputGuardDisabled =
    process.env.PROVIDER_OUTPUT_GUARD_DISABLED !== "false";
```

so the guard is **disabled unless `PROVIDER_OUTPUT_GUARD_DISABLED` is explicitly set to the string `"false"`**. With the variable unset — the normal case — model output passes through verbatim, character by character, including refusal text. Setting it to `false` is the opt-in path that enables pre-display buffering.

Consequence: the owner's requirement of "no filtering, every character immediately" is the default behaviour of this codebase. What is *not* built yet is the diagnostics half: when a reply is a provider refusal, the chat should show a clear record under that message with the reason, the refusal text, the log identifier and the error code.

**Refusal diagnostics (backend half implemented).** `services/refusal-diagnostics.js` builds the `chat_error_logs` row and the client-facing info from one source of truth, so the log and the UI cannot disagree:

- `message` becomes a plain-language reason that quotes the refusal, e.g. `模型拒绝回答（错误码 provider_boundary_residue）：抱歉，我无法为这类内容提供回复选项。`
- `request_summary` keeps `refusal_text` (capped at 1000 characters) plus `model` and `provider`.
- The returned info carries `code`, `source`, `reason`, `excerpt`, `model`, `provider` and `error_log_id`; it is stored on the message under `tool_calls.refusal_detected`, which is what the client already reads.

Previously `persistRefusalLog` received the refusal text and deliberately discarded it, writing only “诊断不保留回复正文”. That single line was the reason a refusal appeared in the chat with no explanation. Rendering the new fields under the offending message is the remaining frontend step.

Questions that were false choices have been removed: "should the browser read Postgres directly" has no consumer, and "17 versus 9" was a miscount.

---

## 9. Glossary

| Term | Meaning |
| --- | --- |
| companion | a row in `companions`; persona and user details live in `settings` keyed by `(user_id, companion_id)`; count capped by `user_profiles.companion_limit` |
| tenant scope | the `(user_id, companion_id)` pair resolved per request, wrapped by `request-scope.js` |
| prompt mode | `legacy` (three concatenated columns) or `unified` (one column) |
| moment / diary | companion-authored feed posts / dated journal entries |
| co-watch | shared viewing rooms; the exception to the ownership convention |
| kiwi-mem | optional external memory gateway, separate repository, reached via `KIWI_MEM_URL` |

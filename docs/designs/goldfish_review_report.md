# Goldfish Review Report

**Target:** `docs/designs/dengta-home-architecture.md` (129 lines, full file)
**Method:** Elephant-Goldfish Model (EGM), three stateless reviewers, no conversation history, strictly read-only
**Reviewers:** `egm-zoom-out` (Skeptical Architect) · `egm-comprehension` (Fresh Engineer) · `egm-design-critic` (Adversarial)
**Adjudication:** Elephant (this section is the only part written with prior project context)

## Verdict

The document's direction holds — server-mediated tenancy, one Node instance, RLS as a deliberately inert layer — but **its evidence base does not**. Three independent reviewers found, and the Elephant confirmed on this checkout, that:

- The tenancy statistics are wrong (79 tables, not 78; 71 with RLS, not 70; 19 with policies, not 18; 26 policies, not 25).
- Two identifiers the document cites do not exist in the repository (`database: not_checked`, `auth_network_unavailable`). The first came from the **production** `/health` (v0.29.76); the repository's `/health` (v0.29.28) has no `checks` field at all.
- The root cause of that class of error: **the document described the production deployment as if it were the repository.** That is the Elephant's error, and it is recorded here rather than quietly fixed, because the same mistake will recur anywhere the document mixes the two.

The review also found one issue the Elephant had missed entirely and that no earlier audit surfaced: **eight tables have neither RLS nor any GRANT/REVOKE statement.**

---

## Prioritized Findings

### F-01 · Eight tables have no RLS and no privilege statement at all — Severity: Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** §3.2 (whole section), §2 security boundary claim (line 31)
* **Discrepancy Description**: `achievements`, `user_achievements`, `special_dates`, `xhs_connections`, `daily_shots`, `interest_profiles`, `watch_events`, `compatibility_records` have zero `enable row level security`, zero `create policy`, and zero `grant`/`revoke` in the entire migration tree. Verified by the Elephant independently.
* **Rationale & Recommendation**: Whether these are reachable from a browser depends on Supabase project-level default privileges, which the repository neither sets nor revokes. "The repository declares nothing" is itself the defect, and it directly contradicts §2's claim that everything privileged happens server-side. Cheapest fix in the whole review: `enable row level security` + `revoke all ... from anon, authenticated`, two lines per table. The document must stop arguing about the 52 policy-less tables (already blocked at the GRANT layer) and name these eight instead.

### F-02 · §3.4 proposes a data path that does not exist — Severity: Blocker
* **Reviewer Lens:** `egm-zoom-out`, `egm-comprehension`, `egm-design-critic` (three-way agreement)
* **Affected Scope:** §3.4 (lines 60–62), §8 question 1
* **Discrepancy Description**: The document offers "give the 52 tables SELECT-only policies so the browser can read its own rows" as one of two defensible options. The browser never reads Postgres directly: `frontend/src` contains zero `.from(` calls, and `auth-session.js:16` builds an auth-only GoTrue client by design.
* **Rationale & Recommendation**: There is no consumer. Adding the policy surface creates a second, semantically different data channel and a second place where tenancy must be maintained — the opposite of what a single-maintainer product needs. Delete the option. The real decision is narrower: keep RLS inert as an explicit policy, remove the 17 admin-client fallbacks, and fix F-01.

### F-03 · Tenancy statistics are wrong, and they are the document's entire argument — Severity: Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** §3.2 (lines 49–52), §8 question 3
* **Discrepancy Description**: Measured on the migration tree: 79 tables (doc: 78), 71 with RLS (70), 19 with policies (18), 26 policies (25). 11 policies allow writes across 7 tables (`memory_calendar`, `bilibili_qr_sessions`, `ai_music_play_requests`, `whereabouts_points`, `whereabouts_state`, `timeline_taxonomy`, `timeline_days`) — the document claimed only `memory_calendar` was an exception. Separately, `requireRequestScope` has **225 call sites across 32 files**; the document's "9" counted textual occurrences in `server.js` and included the import line (8 real call sites).
* **Rationale & Recommendation**: The conclusion (RLS alone does not defend tenants) survives, but the evidence was understated in one direction and miscounted in another. The "17 fallbacks vs 9 strict reads" asymmetry, which the document builds a question on, is actually 17 against 217 — an enumerable legacy list, not an architectural rift. Re-measure from a replayed database, not from grep, and state the counting method.

### F-04 · The ChatTranscript performance attribution is wrong in both directions — Severity: Blocker
* **Reviewer Lens:** `egm-zoom-out`, `egm-comprehension`, `egm-design-critic` (three-way agreement)
* **Affected Scope:** §5 (line 94), §8 question 4
* **Discrepancy Description**: `ChatTranscript.jsx:21` is a plain function component with no `memo`. The memoized component is the row component `Entry` (`:7`). `privateMediaCatalog` does get a new reference each render, but it breaks `Entry`'s memo, not a nonexistent `ChatTranscript` memo.
* **Rationale & Recommendation**: The proposed remedy ("memoize the catalog") would change nothing. The real mechanism is 120 root-level `useState` calls: one keystroke re-renders the tree, and `Entry`'s memo is defeated by freshly created inline callbacks. Document the actual blast radius (any render-time exception blanks the whole app) and a staged migration path, or delete the section — hook counts are not architecture.

### F-05 · The document omits the mechanism a new engineer actually needs — Severity: Blocker
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** §3.1–3.4, §4
* **Discrepancy Description**: Missing entirely: (a) `TABLE_SCOPES` is a 73-entry fail-closed whitelist that throws on unknown tables (`request-scope.js:93-97`); (b) each entry carries `companion: true|false` and `kind: "profile"`, and `user_profiles` is owned by `id` not `user_id`; (c) `upsert` is whitelisted to 4 tables and RPC to 4 names with injected `p_user_id`/`p_companion_id`; (d) companion selection comes from the `X-DengTa-Companion-Id` header, falls back to `is_default`, then `companions[0]`, and returns 400/404 for bad or foreign ids; (e) 13 tables sit outside the whitelist by design (co-watch rooms, watch events, device events, …); (f) a chat turn lives almost entirely in `server.js` (`executeChatTurnOnce`, ~680 lines), not in `ai-service.js`, which only does provider transport.
* **Rationale & Recommendation**: A reader following this document will add a table, write a migration, wire a route, and get a 500 that looks like a configuration error. State the whitelist, the ownership column naming rule, and the companion header resolution — these are the three facts that make the tenancy model reproducible.

### F-06 · Deployment prerequisites are not reconstructable — Severity: Blocker
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** §2 (lines 20–31), §7
* **Discrepancy Description**: The document does not reference `backend/.env.example` (the real 85-line variable list) or `docs/DEPLOYMENT.md`. Missing prerequisites that block a first run: `SUPABASE_URL`/`SUPABASE_SECRET_KEY` cause `process.exit(1)` (`server.js:370-373`); `auth-context.js:37-39` rejects users without `email_confirmed_at` (403 `email_not_verified`), so Supabase email confirmation must be enabled or nobody can log in; migration paths are `backend/supabase/`, and `render.yaml`/`vercel.json` live under `backend/` and `frontend/`, not the repository root.
* **Rationale & Recommendation**: Link the two existing documents instead of restating them, and add the two hard blockers (secret key, email confirmation) plus the real file paths.

### F-07 · Background behaviour is documented as running but ships disabled — Severity: Blocker
* **Reviewer Lens:** `egm-design-critic`
* **Affected Scope:** §2.1 (lines 33–35), §6 failure-domain table
* **Discrepancy Description**: `render.yaml` sets `BACKGROUND_JOBS_ENABLED: "false"`; `.env.example:12` is also `false`; `server.js:384-387` defaults to `false`. The tick is driven by `.github/workflows/background-jobs.yml` (`cron: */10 * * * *`). The document's "worker crashes → leases expire → next tick recovers" describes a path that is never enabled in the declared deployment.
* **Rationale & Recommendation**: The product's promise (mood evolves, proactive messages, diary writes) is off in the shipped configuration, and the scheduler is a third-party cron. Separate "code exists" from "deployment enables it", and either enable it in `render.yaml` or write the GitHub-cron dependency into the operations and failure sections.

### F-08 · Unauthenticated 30 MB body parse with no chat rate limit — Severity: Blocker
* **Reviewer Lens:** `egm-design-critic`
* **Affected Scope:** §4.1, §4.2
* **Discrepancy Description**: `express.json({ limit: "30mb" })` at `server.js:579` runs before authentication at `:597`, so any unknown path parses a 30 MB body without credentials. `/chat` (`:6393`) and `/chat/stream` (`:6421`) have no limiter; the only limiters are voice (`:2810`), expressive TTS (`:6339`), and weather.
* **Rationale & Recommendation**: The document downgrades the missing rate limit by arguing the attacker spends the owner's provider key rather than the platform's. That argument requires an account; the 30 MB parse does not. On a single free-tier instance this is an availability attack. Lower the JSON limit to 1–2 MB, mount it per route, and add an IP token bucket before auth — reusing `createVoiceRateLimitState`, which already exists.

### F-09 · `/health` is effectively a constant, and the document invented a field to describe it — Severity: Blocker
* **Reviewer Lens:** `egm-design-critic`, `egm-comprehension`
* **Affected Scope:** §6 table row 3 and body (lines 106–111), §8 question 2
* **Discrepancy Description**: `database: not_checked` does not exist anywhere in the repository; it exists only in production's `/health` (v0.29.76). The repository's `/health` returns `ok/time/version/revision/features`, where `features` is a hardcoded map of roughly 60 constants and **no database or dependency is queried**. When Supabase was unreachable, `/health` still returned 200 with `ok: true`, so Render's `healthCheckPath` would keep routing traffic to a backend that cannot serve data.
* **Rationale & Recommendation**: State that `/health` is liveness only and that its `features` map is a build-time capability list, not runtime state. Do not add a public database probe — an unauthenticated endpoint that queries Postgres is a free load generator. Mirror the existing authenticated pattern (`/api/v2/memory/health`) for a deep check.

---

### F-10 · GRANT layer and RLS layer are conflated, hiding the only dangerous combination — Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** §3.2 (lines 49–52)
* **Discrepancy Description**: `grant select` appears only in `012:1178-1188` (11 tables), `055:36`, and `056:31`. The 52 policy-less tables are unreadable today because they lack GRANTs, not because RLS denies. Enabling a table's RLS without noticing it has no GRANT and no RLS is exactly the composition that leaks.
* **Rationale & Recommendation**: Describe the two layers separately: GRANT decides whether a role may reach the table; RLS decides which rows. The dangerous population is "GRANT present, RLS absent" — which is F-01's eight tables, if default privileges ever grant them.

### F-11 · The 17-fallback framing overstates an enumerable legacy list — Severity: Major
* **Reviewer Lens:** `egm-comprehension`, `egm-design-critic`
* **Affected Scope:** §3.3 (lines 56–57), §8 question 3
* **Discrepancy Description**: The 17 `req.scope?.db || supabase` occurrences are all in `server.js` at known line numbers (5264, 5316, 5357, 5374, 5392, 5418, 5473, 5512, 5539, 5586, 5595, 5611, 5654, 5869, 5951, 6022, 6304). With `AUTH_REQUIRED=false` and no token, `req.scope` is empty by design (`auth-context.js:318-321`), so the fallback is the *only* reachable path — including `GET /sessions/:id/messages`, which has no limit and no cursor (`server.js:5510-5525`).
* **Rationale & Recommendation**: Do not invent a new "explicitly public" helper; `createTenantDatabase({ adminSupabase, tenant })` already exists (`request-scope.js:194`). Either route all 17 through `requireRequestScope`, or route them through the existing tenant API and delete the silent fallback. Also fix `.env.example:4`, which ships `AUTH_REQUIRED=false` — the self-hosting target audience gets an anonymous, writable API.

### F-12 · No request cancellation; abandoned streams are still billed and persisted — Severity: Major
* **Reviewer Lens:** `egm-design-critic`
* **Affected Scope:** §4.1 (lines 80–81)
* **Discrepancy Description**: No `req.on("close")` anywhere in the backend. `ai-service.js` uses `AbortController` only for a 300 s timeout (`:1612-1617`), `max_tokens <= 0` means unlimited output (`:156-158`), and retry is one fixed 250 ms attempt (`:1861`, `:69`) — the document's "single attempt" is also inaccurate.
* **Rationale & Recommendation**: On a mobile disconnect the upstream generation completes, is persisted, and is never seen by the client; a resend either 409s (`CHAT_GENERATION_IN_PROGRESS`) or pays twice and produces a duplicate visible after refresh. `media-stream-relay.js:8-9` already implements the same close-propagation pattern — copy it. Cap `max_tokens` server-side.

### F-13 · Migration verification exists but is not in the pipeline — Severity: Major
* **Reviewer Lens:** `egm-zoom-out`, `egm-design-critic`
* **Affected Scope:** §7 (lines 117–118), §8 question 5
* **Discrepancy Description**: 68 migrations, no `schema_migrations` ledger. `npm run audit:migrations` exists but `.github/workflows/ci.yml` never calls it; `multitenant-pglite.test.mjs:80` replays only the first 12. Migrations 013–061 have never been built by automation on any commit. The document's "verification is a single command" is not executable.
* **Rationale & Recommendation**: This is the Elephant's own gap — the replay script was added this session and never wired into CI. Add it to `ci.yml` (one line). Do not renumber, and do not build a ledger yet: `DEPLOYMENT.md:12` already documents the "do not blindly reapply" policy, and a ledger earns its cost at the second deployment, not before.

### F-14 · "Independently versioned prompt layers" is not what the code does — Severity: Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** §4 (line 76)
* **Discrepancy Description**: `004` adds three columns to `settings`; `011` adds `prompt_mode` (`legacy`|`unified`) plus `unified_system_prompt`; `ai-service.js:351-361` is a two-way branch. There is no `prompt_layers` table and no per-layer versioning.
* **Rationale & Recommendation**: Describe it as a legacy/unified switch. Also state both memory limits: 12 memories × 5,000 chars per turn and a separate 6,000-char budget (`memory-budget.js:1`); the document quotes only one number.

### F-15 · Client facts in §5 are inverted or absent — Severity: Major
* **Reviewer Lens:** `egm-comprehension`, `egm-zoom-out`
* **Affected Scope:** §5 (lines 92–96)
* **Discrepancy Description**: 14 global stylesheets, not 15. The lazy chain is `main.jsx → LoadedApp → LazyApp → App`, not `LazyApp` alone. `main.jsx` also has an unauthenticated `/receive` branch (`ReceiverApp`) and service-worker registration.
* **Rationale & Recommendation**: Correct the chain, and either compress the section to one sentence ("state lives in a single 9,588-line root component") or delete it.

### F-16 · Single-instance rationale is contradicted by the code — Severity: Major
* **Reviewer Lens:** `egm-design-critic`
* **Affected Scope:** §2.1 (line 35)
* **Discrepancy Description**: Leases already make claiming multi-instance safe: `for update skip locked` (`014:103`), a partial unique index for recurring jobs (`015:6-17`), and lease heartbeat with lost-lease detection (`background-job-worker.js:95-150`). What actually breaks at two instances is in-memory state: per-process rate limiters, the 24-entry/25 MB TTS cache, and one `setInterval` per instance.
* **Rationale & Recommendation**: Rewrite as "single instance is a deployment contract (`plan: free`); the lease layer is multi-instance safe; the only hard constraint is in-process rate limiting and caching."

### F-17 · History fetch has no cursor or limit — Severity: Major
* **Reviewer Lens:** `egm-design-critic`
* **Affected Scope:** §5
* **Discrepancy Description**: `GET /sessions/:id/messages` (`server.js:5510-5525`) has no limit or cursor; the frontend calls it from at least five places, and `inner-monologue-sync.js:83` fetches the same history a second time.
* **Rationale & Recommendation**: Accept as known technical debt, but write it down: for a product whose selling point is long-term relationship, "longer memory makes the UI slower" is a product-level defect, not a performance nit.

### F-18 · §8's five questions are not decidable — Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** §8 (lines 123–129)
* **Discrepancy Description**: Each question is "A or B" with no cost for either branch, no decider, and no criterion. F-02 shows one is a false choice.
* **Rationale & Recommendation**: Replace with a decision table: option, cost of choosing it, cost of not choosing it, who decides.

### F-19 · Terminology is used as common vocabulary without definition — Severity: Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** throughout (`companion`, `tenant scope`, `prompt layer`, `co-watch`, `kiwi-mem`, `moment`, `diary`)
* **Discrepancy Description**: `companion` is a row in `companions` (`name`/`is_default`/`status`), while persona and user details live in `settings` keyed by `(user_id, companion_id)`, and the count is capped by `user_profiles.companion_limit`. `kiwi-mem` appears once in a table with no repository, link, or contract.
* **Rationale & Recommendation**: Add a five-line glossary; it is the cheapest fix in this report.

---

### F-20 · Route count and helper description are both wrong — Severity: Nit
* **Reviewer Lens:** `egm-comprehension`, `egm-zoom-out`
* **Affected Scope:** §3.3 (line 58)
* **Discrepancy Description**: `routes/co-watch-rooms.js` registers 12 routes, not 19. Membership validation is centralized in `requireRoomParticipant` (`services/co-watch-rooms.js`), not handwritten per route.
* **Rationale & Recommendation**: Correct both; the document currently implies work that does not need doing.

### F-21 · Retry description is inaccurate — Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** §4.1 (line 81)
* **Discrepancy Description**: `for (let attempt = 0; attempt < 2; attempt += 1)` with a fixed 250 ms delay is one retry, not a single attempt. Demanding backoff and jitter without a failure record is itself premature optimization.
* **Rationale & Recommendation**: Say "one retry, fixed 250 ms" and drop the recommendation unless a failure is observed.

### F-22 · Character budget is presented without its consequence — Severity: Nit
* **Reviewer Lens:** `egm-design-critic`
* **Affected Scope:** §4 (line 76)
* **Discrepancy Description**: 6,000 characters is roughly 6,000–9,000 tokens in Chinese and 1,500–2,000 in English — a 3–4× difference in effective constraint for the same configured number.
* **Rationale & Recommendation**: State the consequence; if precision matters, estimate by script weight or use the provider tokenizer.

### F-23 · Internal endpoints precede authentication — Severity: Nit
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** §2 (line 31)
* **Discrepancy Description**: `/internal/background-jobs/tick` is mounted at `server.js:578`, before the auth middleware, guarded by `BACKGROUND_JOB_TRIGGER_SECRET`; `PUSH_SECRET` works the same way. §2's "the only shared secret boundary" omits both.
* **Rationale & Recommendation**: List secret-authenticated, identity-less entry points alongside the JWT path.

### F-24 · `trust proxy` affects the rate-limit key and is undocumented — Severity: Nit
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** §4.1
* **Discrepancy Description**: `server.js:361` sets `app.set("trust proxy", 1)`, which determines what `req.ip` means for the in-memory limiters.
* **Rationale & Recommendation**: One sentence in the failure-domain table.

---

## Elephant Adjudication

**Accepted and corrected in the document** (verified on this checkout): F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-08, F-09, F-10, F-11, F-13, F-14, F-15, F-16, F-18, F-19, F-20, F-21, F-22, F-23, F-24.

**Contested in part:**
- F-17's severity. It is real, but calling it Major overstates today's impact: the owner's own history is 27 conversations. Kept as Major anyway because the product promise is long-term memory and the cost compounds silently.
- F-12's "retry also pays twice" clause: the retry fires only on stream failure before output, so the double charge is narrower than stated. Kept the cancellation finding, narrowed the retry wording.

**Divided reviewers, decided by the Elephant:**
- **Question 2 (`/health`):** `egm-design-critic` wants a public `/health/db`; `egm-zoom-out` refuses to give an unauthenticated endpoint a database probe. **The zoom-out position wins** — the backend already exposes an authenticated memory-health route with the right shape, and a public probe is a free load generator. Document `/health` as liveness, add the deep check behind auth.
- **Question 5 (migrations):** `egm-design-critic` wants a `schema_migrations` ledger; `egm-zoom-out` wants the existing replay script wired into CI and no new mechanism. **Split decision:** wire CI now (one line, closes a verified gap), defer the ledger until a second deployment exists. A ledger is correct eventually; building it now is speculative for a single-owner install.

## Counts

| Severity | Count |
| --- | --- |
| Blocker | 9 |
| Major | 10 |
| Nit | 5 |

## The single most damaging gap

The document describes a system whose tenancy is enforced by a **fail-closed whitelist** and simultaneously argues about RLS as if it were the boundary. A reader takes away the weaker of the two models. Fix the description, not the code: whitelist, ownership column naming, companion header, GRANT layer, and the eight bare tables.

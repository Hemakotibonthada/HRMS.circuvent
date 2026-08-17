# Circuvent Platform — Phased Roadmap

**Sequence (agreed):** Phase 0 Plan → Phase 1 Foundation → Phase 2 HRMS Features → Phase 3 Mobile
**Branch policy:** all work lands on `develop` in each repo, then PR → `main`.
**Companion doc:** [`PLATFORM-ARCHITECTURE.md`](./PLATFORM-ARCHITECTURE.md)

---

## Phase 0 — Plan ✅

| Deliverable | Status |
|---|---|
| Full as-is audit of all 6 apps (stack, routes, LOC, data, deploy, integration) | ✅ |
| Target architecture on Neon + Vercel + Oracle + GoDaddy | ✅ |
| Neon MCP server installed (Copilot CLI + Claude Desktop) | ✅ |
| `develop` branch confirmed/created per repo | ✅ |
| This roadmap | ✅ |

**Exit criteria:** architecture and sequence signed off. → **Met.**

---

## Phase 1 — Foundation (HRMS first)

Goal: HRMS running on Neon + Vercel with real auth, real tests, and no Firebase — without
changing a single UI component. Everything after this rides on this base.

### Progress

| # | Task | Status |
|---|---|---|
| 1.1.2 | Drizzle + `@neondatabase/serverless` + `pg` installed | ✅ |
| 1.1.3 | `identity` + `hrms` schemas transcribed from `src/types/` — 38 tables | ✅ |
| 1.1.4 | RLS enabled on all 37 org-scoped tables, `FORCE` + `WITH CHECK` | ✅ |
| 1.1.5 | Composite indexes, FKs, CHECK constraints, maker-checker on payroll | ✅ |
| 1.2.1–1.2.4 | `EmployeeRepository` contract + Firestore, Neon, HTTP and dual-write implementations behind `DATA_BACKEND` | ✅ |
| 1.3.1 | Argon2id password hashing (OWASP params, PHC format, timing-safe) | ✅ |
| 1.3.2 | 15-min access JWT + rotating 30-day refresh token, stored hashed | ✅ |
| 1.3.3 | `.circuvent.com` cookie scoping for cross-app SSO | ✅ |
| 1.3.4 | TOTP MFA + single-use backup codes | ✅ |
| 1.3.5 | Edge middleware verifying the access JWT, replacing client-side `AuthGuard` | ✅ |
| 1.3.6 | Firestore → Neon data migration script (idempotent, dry-run, reconciling) | ✅ |
| 1.4.1 | Hardcoded Firebase key fallbacks removed; missing config now fails fast | ✅ |
| 1.4.3 | Per-user rate limiting on employee + login API routes (in-memory; Redis later) | ✅ |
| 1.4.6 | Zod validation at every employee and auth API boundary | ✅ |
| 1.4.7 | Hash-chained, insert-only audit log with tamper detection | ✅ |
| 1.5.1 | Vitest + 107 tests across payroll, RBAC, dual-write, auth, middleware, stores | ✅ |
| 1.5.5 | GitHub Actions `verify` workflow + gitleaks secret scanning | ✅ |
| 1.2.6 | `startSync` routes employees through the repository when `DATA_BACKEND != firestore` | ✅ |
| — | `npm run db:verify` — migrations + 7 tenant-isolation assertions on PGlite | ✅ |
| — | Real `/api/employees` CRUD, replacing a stub that returned `[]` | ✅ |
| — | `/api/auth/login`, `/refresh`, `/logout`, `/me` | ✅ |
| — | README with setup, architecture, commands and known issues | ✅ |
| 1.1.1 | Create the Neon project and branches | ⏳ needs Neon MCP (CLI restart) |
| 1.2.5 | Nightly reconciliation job on the Oracle worker VM | ⏳ next |
| 1.6.x | Vercel projects, DNS cutover, Oracle VMs, backups | ⏳ next |
| — | Extend the repository pattern to leave, attendance and payroll | ⏳ next |

### Found during Phase 1 verification

Enabling the pipeline surfaced defects that were previously invisible:

| Defect | Where | Resolution |
|---|---|---|
| `generatePayslip` produced `NaN` net pay when a month had 0 working days — `Infinity × 0` propagated through `lopDeduction` into a bank payment instruction | `src/lib/payroll-engine.ts` | Fixed — guarded the divisor |
| `goals.create` duplicated in `MANAGER_PERMISSIONS` | `src/lib/rbac.ts` | Fixed |
| `updateAndSync` never reverted its optimistic write — a failed save left the UI showing an edit that was never persisted | `src/stores/unified-store.ts` | Fixed — captures the prior row and restores it |
| `removeAndSync` never restored a deleted row — it vanished from the list but remained in the database and reappeared on refresh | `src/stores/unified-store.ts` | Fixed — restores the previous list, preserving order |
| `startSync` set `loading: true` with no error path, so a permission or network failure left the UI spinning forever | `src/stores/unified-store.ts`, `src/lib/collection-service.ts` | Fixed — added an `onError` channel |
| ESLint had never actually run: `FlatCompat` threw `Converting circular structure to JSON` against `eslint-plugin-react-hooks@7` | `eslint.config.mjs` | Fixed — use `eslint-config-next`'s native flat configs |
| `.firebase/` deploy output was being linted, producing ~44,000 spurious problems | `eslint.config.mjs` | Fixed — added to `ignores` |
| **44 pre-existing `react-hooks` errors**, incl. `Math.random()` / `Date.now()` called during render across 20 dashboard pages — a hydration-mismatch source | `src/app/(dashboard)/**`, `src/hooks/use-advanced.ts` | **All 44 fixed** — see "Reaching zero lint errors" below. |
| ~940 lint warnings (`no-explicit-any`, `no-console`) | repo-wide | ⏳ Phase 2.4 backlog (925 remaining) |

### Reaching zero lint errors

The last 9 errors are gone; `npm run lint` reports **0 errors, 925 warnings**. Four were real
defects, five were the React Compiler refusing to optimise a component:

| Error | Where | What it actually was |
|---|---|---|
| `set-state-in-effect` | `src/components/sso-error.tsx` | Genuine, and the only one blocking `npm run verify`. The value is a query parameter that must be read *and consumed* — shown once, then cleared so a refresh cannot resurrect a stale failure. That rules out `useSyncExternalStore` (its snapshot must stay stable, and clearing the URL changes it) and rules out deriving it during render (no `window` on the server ⇒ hydration mismatch). Resolved the way `useNotificationPermission` already does it in `use-advanced.ts`: a narrowly scoped disable with the reason written down. |
| `react-hooks/refs` | `mobile/src/lib/session.tsx` | Genuine. `mounted.current` was read during render, inside the `useMemo` that built the API client. Two bugs in one: a memo is a *cache* React may discard and recompute, and a second `MobileApiClient` carries its own in-flight refresh — two clients racing to rotate the same refresh token is what the server treats as a replay, revoking the whole session family. Now `useState` with a lazy initialiser, which is the construct that actually promises "once". The ref was **deleted rather than moved**: it guarded `setState` after unmount, which React 18 made a harmless no-op when it removed that warning, so it was defending against nothing while performing a real side effect during render. |
| `no-require-imports` ×2 | `mobile/metro.config.js` | The rule being wrong about the file. Metro loads its config with `require` before any ESM loader exists. Added an `eslint.config.mjs` override for `**/*.config.{js,cjs}`. |
| `preserve-manual-memoization` ×4 | `offboarding`, `onboarding`, `onboardinghub` | A half-finished refactor. Each memo called a helper that closed over a piece of state, and listed *that state* in its dependency array instead of the helper. Correct by manual bookkeeping only — the moment the helper starts reading something else, the memo silently goes stale. Two of the three helpers were already wrapped in `useCallback`; the deps were finished, and `getCurrentPhase` was wrapped to match. |
| `preserve-manual-memoization` ×1 | `celebrations` | The compiler declined to memoise at all. Cause was the **early return** inside the memo, plus `forEach`+`push` followed by an in-place `sort` — the compiler treats a value as frozen once a closure captures it. Rewritten as a single expression with `flatMap` and a copy before sorting. |

Note that React Compiler is *not* enabled in `next.config.ts`, so these five were lost optimisation
rather than live bugs. They were fixed because four of them pointed at real staleness hazards, not
because the rule was complaining.

**Enabling React Compiler is now unblocked.** These 5 errors were the only thing standing in its
way, and `npm run lint` is at zero across the repo. Turning it on is
`experimental: { reactCompiler: true }` plus the `babel-plugin-react-compiler` dependency, which is
not currently installed. It is deliberately left off here rather than flipped at the end of an
enhancement pass: it changes how all 92 dashboard pages compile, and "the build succeeded" is
necessary but not sufficient evidence for that — it wants a run through the pages before it ships.

### "Today" was computed in UTC, and this is an Indian product

`new Date().toISOString().split("T")[0]` appeared **22 times across 14 dashboard pages**.
`toISOString` renders in UTC, so in `Asia/Kolkata` — UTC+5:30, and this platform's default zone —
every one of those calls returned *yesterday's* date between 00:00 and 05:30 IST.

That is not a rare edge case in an HR product. It is the early shift clocking in, the night shift
clocking out, and the SLA clock on a grievance filed at 2am:

| Page | What went wrong before 05:30 IST |
|---|---|
| `attendance` | The "today" key missed the early shift's own clock-in; present/absent/WFH KPIs all counted the wrong day |
| `dashboard` | Present-today and WFH-today read the previous day |
| `leavehub` | The team calendar dropped anyone whose leave started today |
| `visitors`, `meetings` | Today's visitors and today's meetings both showed the previous day's |
| `grievances` | `filedDate` and the 14-day `slaDeadline` were both stamped a day early |
| `awards`, `leave`, `referrals`, `reviews`, `provisioning`, `celebrations` | New records stamped with yesterday's date |
| `audit`, `admin` | Activity charts bucketed events into the wrong day |
| `celebrations` | Work anniversaries were rendered a day early *year-round*, not just before dawn — `toISOString` on a locally-constructed midnight shifts back a day in every zone east of Greenwich |

The convention already existed and was simply not being followed: `src/lib/sla.ts` and
`src/lib/notifications/engine.ts` both default to `Asia/Kolkata` and resolve wall-clock dates
through `Intl.DateTimeFormat`, and `useToday()` in `src/hooks/use-now.ts` was already correct — its
doc comment even names "the class of bug that makes an attendance page show the wrong day".

Fixed by adding `src/lib/date-keys.ts` (25 tests) and routing every call site through it:

- `dateKeyInZone(instant, tz)` — the calendar date in a zone at a real moment
- `todayKey(tz, now)` — today, with an injectable clock
- `toLocalDateKey(date)` — the date a Date built from *parts* is carrying, read from local fields
- `addDaysToKey(key, n)` — day arithmetic done in UTC, so a daylight-saving transition in the
  runner's zone cannot knock it sideways

`useToday()` now delegates to `dateKeyInZone` so the hook and the plain function cannot drift apart.
Components use the hook (it also returns `null` until mounted, so server and first client paint
agree); event handlers and loops use the functions. Zero `toISOString().split("T")[0]` remain under
`src/app/(dashboard)`.

### Fabricated metrics found while fixing the purity errors

The `Math.random()` calls were not merely a hydration bug. Each one invented a number and rendered
it as a measured figure — an HR admin reading "Satisfaction: 87%" had no way to know it was noise.
They have been replaced with values derived from real data, or removed:

| Where | Was | Now |
|---|---|---|
| `admin` — org health radar | Engagement, Satisfaction, Productivity were `Math.random()` | Goal completion, helpdesk resolution and expense approval rates, all computed from their stores |
| `admin`, `dashboard` — department radar | `satisfaction` and `performance` random | Average goal progress per department |
| `admin` — monthly KPI trends | `satisfaction` and `engagement` series random | Series removed; hiring and attrition are real |
| `analytics` — eNPS, Satisfaction, Engagement | random percentages | eNPS renders `—` (no survey data loaded); the other two replaced with headcount and open roles |
| `analytics` — department health score | random 60-95% | Share of the department not on notice or terminated |
| `engagement` — monthly trend | real score jittered by `Math.random()` | Feedback volume per month |
| `performancesuite` — self vs manager | `self` was manager rating plus random | `self` series removed until self-assessments exist |
| `recruitment` — candidate funnel | each stage `Math.random() * applicants` | Real applicant total on the first stage, `—` elsewhere |

### Remaining `react-hooks` errors (5)

All five are `preserve-manual-memoization` — the React Compiler declining to optimise a component
because it would memoise differently from the hand-written `useMemo`. That is a lost optimisation,
not a correctness bug, and chasing it further risks introducing real defects through speculative
refactoring.

Fixed in this pass, beyond the purity errors:

| Was | Why it mattered | Now |
|---|---|---|
| `useIntersectionObserver` and `useInterval` wrote a ref during render | A ref write is a side effect; React may discard a render pass under concurrent features or run it twice in StrictMode, so the write can happen for a pass that never commits | Assigned in an effect |
| `usePrevious` read a ref during render | Same hazard in reverse — the ref may hold a value written by a discarded pass | Held in state, compared with `Object.is` |
| `useMediaQuery` and `useThemeDetector` used `useState` plus an effect | Rendered once with a default and then corrected it, causing a flash of the wrong layout on every mount | `useSyncExternalStore` with an explicit server snapshot |
| `usePagination` corrected the page number in an effect | Rendered one frame on an out-of-range page — an empty table after a filter shrank the results — then re-rendered | Clamped during render |
| `succession` seeded plans from employees in an effect | Rendered empty, then re-rendered with content; re-ran whenever `plans.length` changed | Derived with `useMemo`, with a separate override for user edits |
| `celebrations` mutated a `Date` in place with `setFullYear` | Mutating a locally created object makes the compiler bail out of the whole component | Constructs the next year's date directly |
| `offboarding` and `onboarding` memos called plain component-scope helpers | Recreated every render, so the compiler could not trace the memo to its real dependency | Helpers wrapped in `useCallback` |

### 1.1 Data layer

| # | Task | Detail |
|---|---|---|
| 1.1.1 | Create Neon project `circuvent` | Schemas: `identity`, `hrms`, `ats`, `cv365`, `mail`, `web` |
| 1.1.2 | Add Drizzle + drizzle-kit | `@neondatabase/serverless` HTTP driver for edge, `pg` Pool for workers |
| 1.1.3 | Transcribe `src/types/*.ts` → Drizzle schema | ~110 interfaces → ~90 tables. Enums become PG enums. |
| 1.1.4 | Enable RLS on every tenant-scoped table | `USING (org_id = current_setting('app.org_id')::uuid)` |
| 1.1.5 | Indexes + constraints | FK integrity, composite indexes replacing the empty `firestore.indexes.json` |
| 1.1.6 | Seed + fixture data | Deterministic seed for tests and local dev |

### 1.2 Repository abstraction (the strangler seam)

| # | Task | Detail |
|---|---|---|
| 1.2.1 | Define `I*Repository` per domain | Employee, Leave, Attendance, Payroll, Recruitment, … |
| 1.2.2 | Wrap existing Firestore calls as `Firestore*Repo` | Zero behaviour change |
| 1.2.3 | Implement `Neon*Repo` | Drizzle-backed |
| 1.2.4 | `DATA_BACKEND=firestore\|neon\|dual` switch | Instant rollback, no redeploy |
| 1.2.5 | Dual-write + nightly reconciliation job | Runs on Oracle `vm-worker`; diff report to admin |
| 1.2.6 | Point Zustand stores at repositories | Stores keep their public API — UI untouched |

### 1.3 Identity service

| # | Task | Detail |
|---|---|---|
| 1.3.1 | `identity` schema + Argon2id password hashing | |
| 1.3.2 | JWT access (15 min, EdDSA) + opaque rotating refresh (30 d) | `jose`, mirrors Mail.circuvent |
| 1.3.3 | Cookie `Domain=.circuvent.com` | True SSO across all subdomains |
| 1.3.4 | TOTP MFA + backup codes | `otpauth` + `qrcode` |
| 1.3.5 | Edge middleware token verification | No DB round-trip on the hot path |
| 1.3.6 | Firebase Auth user import + forced password reset | Firebase hashes are not portable |
| 1.3.7 | Replace `cross-app-sync.ts` fan-out with single `identity.users` read | Deletes an entire class of drift bugs |

### 1.4 Security hardening

| # | Task | Detail |
|---|---|---|
| 1.4.1 | Delete hardcoded Firebase key fallbacks | `firebase.ts:55`, `cross-app-sync.ts:33` — fail fast if env missing |
| 1.4.2 | Rotate every credential; purge from git history | `git filter-repo`; rotate Firebase, SMTP, JWT, service tokens |
| 1.4.3 | Rate limiting on all API routes | Upstash Redis, per-IP + per-user + per-org |
| 1.4.4 | CSRF tokens on state-changing routes | |
| 1.4.5 | Security headers + strict CSP | `next.config.ts` headers |
| 1.4.6 | Zod validation at every API boundary | Schemas already exist in `form-schemas.ts` |
| 1.4.7 | Immutable, tamper-evident audit log | Hash-chained `identity.audit_log` |
| 1.4.8 | Secret scanning in CI | gitleaks |

### 1.5 Reliability & quality

| # | Task | Detail |
|---|---|---|
| 1.5.1 | Vitest + Testing Library | Priority: `payroll-engine`, `rbac`, leave accrual, tenant isolation |
| 1.5.2 | Playwright E2E | login → employee CRUD → leave → payroll run |
| 1.5.3 | Error Boundaries per dashboard section | One module crashing must not blank the app |
| 1.5.4 | Sentry + `pino` structured logging | Request IDs correlated across apps |
| 1.5.5 | GitHub Actions CI | typecheck → lint → test → build; blocks merge to `develop` |
| 1.5.6 | Coverage gate ≥ 70% on `src/lib` | |

### 1.6 Deployment

| # | Task | Detail |
|---|---|---|
| 1.6.1 | Vercel project per app; `develop` → preview, `main` → prod | |
| 1.6.2 | Neon branch per PR, auto-deleted on merge | |
| 1.6.3 | GoDaddy DNS → Vercel for all subdomains | Table in architecture doc §2.6 |
| 1.6.4 | Provision Oracle VMs `vm-mail`, `vm-worker`, `vm-ops` | Always-free ARM Ampere |
| 1.6.5 | BullMQ workers on `vm-worker` | Payroll runs, reports, bulk import, reconciliation |
| 1.6.6 | Automated `pg_dump` backups + restore drill | RPO 1 h / RTO 4 h, restore tested |
| 1.6.7 | Retire Firebase Hosting | ✅ Done — see below |

**Exit criteria:** HRMS serves 100% of reads/writes from Neon on Vercel; Firebase removed from
`package.json`; CI green; payroll + RBAC + tenant-isolation tests passing; restore drill completed.

**Firebase removal — completed.** The last traces went in one pass:

| Removed | Was |
|---|---|
| `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` | Config for a project nothing connected to |
| `firestore-debug.log` | Emulator output, committed by accident |
| `src/lib/firebase-env.ts` | Imported by nothing |
| `scripts/firestore-source.ts`, `scripts/migrate-to-neon.ts`, `npm run db:migrate:data` | The one-time Firestore → Neon copy. The cutover is finished, and this was the only thing still pulling `firebase-admin`. |
| `firebase-admin` devDependency | — |
| `NEXT_PUBLIC_FIREBASE_*` in `vitest.setup.ts`, `.env.example`, and the CI build step | Placeholder values kept alive for a module that no longer existed |
| `firebase` flag on `/api/health` | Reported readiness of a service that had already been deleted |

`src/lib/firestore-service.ts` → **`src/lib/collection-service.ts`** (84 importers updated). It had
contained no Firebase for some time — it is an HTTP client for this app's own API routes — but the
name kept implying a dependency that was gone, which is how the README came to describe a
`DATA_BACKEND` switch that no longer existed.

---

## Phase 2 — HRMS Enterprise Features

The 92 existing modules are broad but shallow. Phase 2 adds the platform capabilities and depth
that enterprise buyers actually evaluate on.

### 2.1 Platform capabilities (the real differentiators)

| Feature | Status | Why it matters |
|---|---|---|
| **Visual workflow engine** | ✅ engine + tests (`src/lib/workflow/engine.ts`) | Drag-drop approval chains, conditional routing, parallel/serial approvers, delegation, SLA timers, auto-escalation, reminders. Every HR process becomes configurable instead of hard-coded. UI still to build. |
| **Report builder** | ✅ builder + presets + `/api/reports/run` | Drag-drop dimensions/measures, saved views, scheduled delivery, XLSX/PDF/CSV export. Designer UI and scheduling still to build. |
| **Notification engine** | ✅ engine + tests (`src/lib/notifications/engine.ts`) | Multi-channel, per-user preferences, quiet hours, digest batching, idempotency. Transports (Resend, Expo push, SMS) still to wire. |
| **Public API + webhooks** | ✅ API surface | Versioned REST at `/api/v1`, per-org API keys, scoped tokens, rate limits, OpenAPI spec at `/api/v1/openapi`. Webhook subscriptions still to build. |
| **Custom fields & custom objects** | ⏳ | Per-tenant schema extension without a deploy. Columns exist on `organizations.custom_fields` and `employees.custom_fields`. |
| **SSO & SCIM** | ⏳ | Schema in place (`sso_connections`, `scim_tokens`); protocol handlers still to build. |
| **Feature flags per plan/tenant** | ⏳ | Column exists on `organizations.features`. |
| **i18n & multi-currency** | ⏳ | `next-intl`, RTL, per-org locale, multi-country payroll rules. |
| **Data governance** | ⏳ | GDPR/DPDP: DSAR export, right-to-erasure, retention policies, field-level encryption, consent tracking. |
| **e-Signature** | ⏳ | Offer letters, policy acknowledgements, PIP sign-off. |
| **Bulk data operations** | ⏳ | Guided import with column mapping, dry-run validation, partial-failure reporting. |

### 2.2 AI layer ("the latest")

| Feature | Status | Implementation |
|---|---|---|
| **Attrition risk prediction** | ✅ `src/lib/intelligence/attrition.ts` | Transparent additive model over tenure, comp ratio, promotion/raise recency, engagement, manager churn, overtime and absence. Every score carries its factors — an unexplained "high risk" is unactionable and indefensible. Protected characteristics deliberately excluded. |
| **Anomaly detection** | ✅ `src/lib/intelligence/anomaly.ts` | Payroll outliers, impossible-travel punches, duplicate and threshold-split expense claims. Median/MAD rather than mean/SD, because the outlier being sought drags the mean. Nothing auto-rejects. |
| **HR Copilot** | ⏳ | RAG over company policies, handbook, and the employee's own records. Replaces the stub `chatbot` module. |
| **Resume parsing & ranking** | ⏳ | Structured extraction + semantic match against JD; column exists (`candidates.parsed_resume`, `applications.match_score`). |
| **Survey sentiment analysis** | ⏳ | Theme extraction + sentiment on free-text feedback and exit interviews. |
| **AI drafting** | ⏳ | JDs, offer letters, review summaries (`performance_reviews.ai_summary`), PIP plans. |
| **Smart scheduling** | ⏳ | Interview slot optimisation across panel calendars. |
| **Semantic search** | ⏳ | pgvector in Neon over employees, policies, documents, tickets. |

### 2.3 HR domain depth

**Delivered so far** (all on `develop`, each with pure rules + tests, a Neon repository, API routes, RLS and DB constraints):

| Module | State | Notes |
|---|---|---|
| **Referrals** | ✅ | State machine, instalment scheduling, duplicate attribution, ATS linkage. Bonus frozen at submission; eligibility re-checked at approval. |
| **Benefits** | ✅ | Plans, enrolment windows, dependants, claims, proration, life-event exceptions. |
| **Shift rostering** | ✅ | Constraint engine (rolling 7-day weeks, night shifts, rest, consecutive days), greedy generation reporting its gaps, two-step swaps re-checked at approval. |
| **Learning** | ✅ | Prerequisites, duration-weighted progress, server-side grading, recertification from completion date, org-wide compliance report including staff with no enrolment. |
| **Documents & e-signature** | ✅ | Token rendering that refuses on a blank, frozen content hash, ordered signing envelope, public token-authenticated signing route. |
| **Custom fields** | ✅ | Definitions and values as real rows; type changes refused once values exist; uniqueness enforced by a trigger-maintained partial index, not an application check. |
| **Data governance** | ✅ | Retention schedules, legal holds, erasure as three separate decisions, append-only evidence, consent per policy version. |
| **SSO + SCIM** | ✅ | OIDC with PKCE, four deprovisioning shapes handled, SAML deliberately not hand-rolled (see `src/lib/sso.ts` header). |
| **Compensation** | ✅ | Merit matrix by rating × quartile, budget as a hard DB constraint, equity vesting, suppressed-group pay gap. |
| **Helpdesk SLA** | ✅ | Business-hours clocks, DST-safe, clock pauses only for the requester, confidentiality as a WHERE clause. |
| **Assets** | ✅ | Depreciation feeding the balance sheet, custody chain, book-value exit clearance. |
| **Indian statutory** | ✅ | PF (with the EPS cap), ESI contribution periods, per-state PT, gratuity at 15/26, marginal income tax, LWF. |
| **Performance** | ✅ | Cascading goal rollup, calibration that reports rather than reshapes, 360° anonymity including the reconstruction-by-subtraction case. |
| **ATS** | ✅ | Pipeline that cannot be skipped, scorecards invisible until submitted, offer approval separation, funnel from the event log. |

**Totals:** 1,170 tests, 62 database isolation checks, `npm run verify` green.

### Defects found and fixed while building these

Each of these was live code, not a hypothetical.

| Defect | Consequence had it shipped |
|---|---|
| **Professional tax, Karnataka**: threshold was ₹15,000; it has been ₹25,000 since April 2023 | ₹200 a month deducted from every employee between the two figures who did not owe it. **The existing test asserted the wrong number, pinning the bug in place.** |
| **Section 87A rebate**: applied below ₹7,00,000; under the Finance Act 2025 it is ₹12,00,000 | Everyone in between taxed on income carrying no liability. At ₹11,00,000 taxable, roughly ₹40,000 taken from someone who owed nothing. Also pinned by a test. |
| **Maharashtra February PT**: the ₹300 rate was commented "Simplified" and skipped | ₹100 per employee per year short of the ₹2,500 statutory maximum. |
| **Employer PF**: a single figure with no EPS/PF split, no admin charge, no EDLI | The split *is* what the ECR file reports; employer cost understated. |
| **ESI**: hard-stopped at the wage ceiling | Someone crossing mid-period lost cover partway through a claim. |
| **Declining-balance depreciation** never reached salvage | Assets never fully depreciated, sitting above their agreed residual for ever. |
| **Two drift checks passed over an empty set** | Caught by a companion check asserting the reflection found something. Now genuinely compares 79 tables and 1,233 columns. |
| **`0005_rls_for_scheduling_tables.sql` missing from drizzle's journal** | `db:verify` reads the directory and passed; `drizzle-kit migrate` reads the journal, so it would never have run in production. Now guarded. |
| **Verifier fixtures batched with the statement under test** | When that statement was correctly rejected the fixture rolled back with it — two checks were passing on a foreign-key error, not the constraint they claimed to test. |
| **Four placeholder tables/columns with zero readers** (`custom_fields` jsonb ×2, `sso_connections`, `scim_tokens`, `tickets`) | Two homes for one concept is how a value is written to one and read from the other — the defect the referral module shipped with. All removed. |
| **`/api/helpdesk` returned `data: []`** after authenticating | Reads as "you have no tickets" rather than "this is not built". |
| **Racy application-level uniqueness on custom fields** | Two concurrent requests both pass the `SELECT` and both insert. Replaced with a trigger-maintained partial unique index. |
| **A regex-on-jsonb check for scorecard ranges** | Would have matched digits inside competency names — rejecting valid cards and passing invalid ones. Replaced with a trigger. |
| **`if (previous?.capturedAt && …)`** in the new geofence spoofing check | A timestamp of `0` is falsy, so the impossible-speed check was skipped entirely for it. Same shape as treating `Number("")` as absent. Now compares against `undefined`. |
| **Two haversine implementations with different Earth radii** — `attendance.neon.ts` used 6,371,000, `mobile/geofence.ts` uses 6,371,008.8 | The phone and the server disagreed by ~1 m per km, enough to put someone on opposite sides of a 50 m office fence depending on which was asked. Consolidated onto the tested module. |
| **The mobile API client could never have signed in** | It read `body.accessToken`; `/api/auth/login` returns `body.tokens.accessToken`, and only when the caller declares itself native — which the client never did. Its own tests encoded the wrong shape, so they passed. Fixed and pinned. |
| **`attendance_review_has_reason_check` passed the row it existed to reject** | `geofence_confidence IN (…)` is `NULL` when the column is `NULL`, and a `CHECK` evaluating to `NULL` passes. Caught by the verifier check written alongside it. |
| **`submit()` reported a *refused* action as a successful one** | It asked "is this still in `pending()`?", and `pending()` deliberately excludes quarantined work. The clock-in screen said "Clocked in" to someone whose punch the server had permanently rejected — they stop thinking about it and find out at payday. Replaced with `outcomeOf()`, which answers in three states. |
| **`0012_doc_store.sql`: number already taken by `0012_compensation`, absent from the journal** | `drizzle-kit migrate` reads the journal, so it would never have run, while the directory listing made it look applied. It also hand-rolled its own tenant policy under a non-standard name — identical behaviour, invisible to the isolation check, two places to remember. |
| **The mobile app had never been compiled** | Adding it to `verify` found real unsafety in shared code that the root config does not check for (`noUncheckedIndexedAccess`): `locateWithin` indexed a sorted array without proving it non-empty. |
| **37 mouse-only controls across 15 pages** | A `<div onClick>` is not focusable and has no role, so keyboard and switch-control users could not reach department filters, calendar days, org chart cards, parking spaces, payslip rows or notifications *at all*. Fixed via one tested helper (`src/lib/a11y/clickable.ts`); the full jsx-a11y recommended set is now enforced in `verify` at zero. |
| **The org chart dialog had no keyboard dismissal** | Its backdrop is mouse-only, so the only exit was to tab through the whole card to the Close button. Now closes on Escape and announces itself as a dialog. |

### `/api/expenses` was a fake, and it lost people's money

Not a stub — a fake. It looked like a working endpoint and was wired into the
dashboard through `collection-service`'s `ENTITY_ROUTES`:

- `GET` returned `data: []` unconditionally.
- `POST` validated the body, built `{ id: "EXP-" + Date.now(), ...body }`,
  returned **201 "Expense submitted"** — and wrote nothing.
- `PATCH` returned **"Expense approved"** without touching anything.

So an employee filed a claim, saw a success toast, and the claim did not
exist. A manager approved it and was told it was approved. In a product that
reimburses people, that is somebody's money quietly disappearing.

Everything needed to do it properly was already there and unused:
`hrms.expense_claims` with row-level security, a unique claim number and
`total_amount_minor` as bigint; `expenses.view`/`submit`/`approve`/`view_all`
in `rbac.ts`; the workflow engine already routing `expense` approvals to that
table; duplicate-claim detection in `intelligence/anomaly.ts`;
`expense.submitted`/`expense.approved` notification templates; an
`expense.submit` kind in the mobile offline queue. Only persistence was
missing.

| Added | |
|---|---|
| `src/lib/expense-rules.ts` | 37 tests. Category limits, claim validation, stage transitions, exact line-item totals, claim-number formatting. |
| `src/db/repositories/expense.neon.ts` | Real persistence, in the shape of `leave.neon.ts`. |
| `GET/POST /api/expenses`, `GET /api/expenses/[id]`, `POST /api/expenses/[id]/decision` | Replacing the fake. |
| `npm run db:verify:expenses` | 17 checks against a real Postgres, wired into `npm run verify`. |

Four things the fake got wrong that are now fixed:

- **Category limits were in the wrong unit.** `travel: 50000` sat next to
  amounts the schema stores as paise, so read consistently it was a ₹500 cap
  rather than ₹50,000. They are now `50_000n * RUPEE`, and a test pins the
  value.
- **Claim numbers came from a clock.** `EXP-${Date.now()}` collides whenever
  two people submit in the same millisecond, and `expense_claims_org_number_key`
  would then reject the second at random under load. The sequence is now
  computed inside the inserting transaction, with the unique index as a
  backstop rather than the mechanism, and the format sorts lexicographically in
  issue order.
- **Nothing stopped a second approval.** `canTransition` is checked against the
  row under `FOR UPDATE`, so a double-clicked Approve cannot reach
  reimbursement twice — which would be paying somebody twice.
- **The total was whatever the client said.** It is now derived from the line
  items with `sumMinor`; a submitted total that disagrees with its own lines is
  either a bug or a claim for more than the lines justify.

Reimbursement is deliberately a separate step from approval, gated on
`payroll.process` rather than `expenses.approve`: a line manager can agree the
spend was legitimate without being able to move money. Approving says the
spend was justified; reimbursing says it has gone out, and collapsing them
leaves no record of what is still owed.

### `/api/recruitment` was the same fake

Found by auditing all 121 route files for handlers that touch no data layer.
It was wired into `ENTITY_ROUTES` exactly like expenses, and it was broader:

| Handler | Claimed | Did |
|---|---|---|
| `GET ?type=pipeline` | A hiring funnel | Eight hardcoded zeroes — on the page whose only purpose is the funnel |
| `GET` | Jobs / candidates | `data: []` |
| `POST` | **"Job posted successfully"** (201) | Nothing |
| `POST` | **"Candidate added"** (201) | Nothing |
| `POST` | **"Interview scheduled"** (201) | Nothing |
| `PATCH` | Moved a candidate's stage | Nothing |

A recruiter posted a role and it did not exist. A candidate was added and
vanished. An interview was "scheduled" and nobody was told.

The waste here is sharper than with expenses: `NeonAtsRepository` (998 lines,
63 tests) sat right beside it with duplicate detection, stage rules, scorecard
visibility, offers and funnel reporting — all real, all tested, all backed by
`job_postings`, `candidates`, `applications` and `offers`. The fake was a
parallel, non-functional implementation of a module that already worked.

Two genuine gaps had to be filled before the route could delegate:

- **No job-posting CRUD.** `job_postings` was read by the pipeline queries but
  nothing could create one. `createJob` derives a careers-site slug from the
  title and makes it unique within the org with a counter — `senior-engineer-2`
  rather than a random suffix, because that URL is a thing people share and
  `senior-engineer-x7f2q` reads as a mistake. `setJobStatus` stamps
  `published_at` only on the first publish, so pausing and resuming a role does
  not make it look newly opened.
- **`hrms.interviews` was an orphaned table** — zero repository references
  anywhere in the codebase. `scheduleInterview` checks the application is real
  and not already rejected or withdrawn, which is precisely what a route that
  validates nothing and writes nothing cannot do.

`scripts/verify-modules.ts` (renamed from `verify-expenses.ts`) now runs **27
checks** against a real Postgres and gates `npm run verify` and CI. Beyond
persistence it pins the constraints that make the module safe: duplicate claim
numbers and duplicate slugs are rejected within an org but allowed across orgs,
an interview cannot be booked against a non-existent application, and neither
job postings nor interviews are visible to another tenant.

### Performance: indexing the sort, not just the filter

Measured with `scripts/audit-indexes.ts`, which cross-references what the
repositories actually filter and order by against what is indexed. Across 102
tables it found 55 candidate gaps, all of the same shape.

Every list endpoint in this application issues the same query:

```
WHERE org_id = current_setting('app.org_id')   -- added by RLS
[AND status = $1]
ORDER BY <a date column> DESC
LIMIT 50
```

The existing indexes covered the *filter* and not the *sort*. `(org_id,
status)` finds a tenant's rows, and Postgres then sorts all of them to return
fifty. Fine on a demo database; a sequential scan plus a sort on the largest
customer — which is the tenant you least want to be slow.

A composite starting with `org_id` is the right shape precisely *because* RLS
puts `org_id = …` on every query: the leading column is always an equality
match, so the rest of the index is already ordered within a tenant and the sort
disappears.

`0026_list_query_indexes.sql` adds twelve, and `npm run db:verify:plans` proves
they work by asking the planner rather than assuming. At 4,000 rows:

| | Plan | Estimated cost |
|---|---|---|
| Before | `Seq Scan` → `Sort` (all 4,000 rows) → `Limit` | **268.88..269.00** |
| After | `Index Scan using expense_claims_org_created_idx` → `Limit` | **0.28..4.21** |

The gap widens with row count, because the "before" plan sorts everything the
tenant has to return a constant fifty rows.

The check includes a **counterfactual**: it drops the index, re-runs `ANALYZE`,
and asserts the sort comes back. Without that step the test would pass equally
well if something else had removed the sort, and the index would be unproven
overhead.

Only columns a repository genuinely sorts on are indexed. The low-cardinality
booleans the audit also flagged (`is_active`, `is_mandatory`, `is_primary`) are
deliberately left alone: Postgres will choose a sequential scan over them
anyway, and an index that is never chosen is worse than none — it costs write
throughput on every insert and buys nothing.

### Expense claims on mobile

The screens deferred earlier in the session, for a stated reason: a form on top
of a fake API would have shown someone a success message for a claim that never
existed. Now that `/api/expenses` persists, they are worth building.

`validateClaim` is imported from the shared core rather than reimplemented, so
the phone and the server cannot disagree. A client that has its own copy of the
rules produces the worst failure mode available — a form that accepts something
the API then refuses, with no way for the person to tell which of the two is
wrong. The category limit is shown before submitting rather than after being
rejected, which is the difference between "adjust this line" and "start again".

Two details worth keeping:

- **Totals add `amountMinor`, never `amount`.** Summing the display floats on a
  phone is exactly the rounding the bigint columns exist to prevent.
- **A partial approval is surfaced on the list card**, not only in the detail
  view. A claim approved for less than it was filed for is the thing a person
  most needs to notice, and it is easy to miss behind a tap.

The claim form sends immediately rather than queuing offline, unlike clock-in
and leave. Those queue because they record something that already happened and
delay costs nothing. A claim is checked against a category limit at the moment
it is filed, so queuing one would mean telling somebody it was accepted when it
may still be refused.

### Onboarding and offboarding checklists were never saved

Found while wiring the lint fixes earlier: both dashboard pages held their tick
state in React `useState` and made no request anywhere.

| Page | What happened |
|---|---|
| `onboarding` | `toggleTask` set local state. No toast, no request. A new joiner's whole 90-day checklist lived in one browser tab and died with it. |
| `offboarding` | `toggleClearance` set local state **and raised `toast.success("Clearance updated")`** — telling the HR admin it had saved when nothing left the browser. |

Offboarding is the serious half. Exit clearance is the record that proves
company hardware came back and access was cut; it is the first thing anyone
asks for after an incident involving someone who has left. A page that reports
"Clearance updated" and stores nothing does not merely lose work — it produces
confident false assurance.

The domain layer had existed all along in `src/lib/employee-lifecycle.ts`:
templates for both journeys, progress arithmetic, and `calculateSettlement`.
Only somewhere to put the answer was missing.

| Added | |
|---|---|
| `0027_employee_lifecycle.sql` | `lifecycle_journeys` + `lifecycle_tasks`, with RLS via the `apply_tenant_rls()` sweep |
| `src/lib/lifecycle-rules.ts` | 34 tests. Progress, blocking tasks, journey transitions, due dates, phase grouping, template validation. |
| `src/db/repositories/lifecycle.neon.ts` | Real persistence |
| `GET/POST /api/lifecycle`, `GET/POST /api/lifecycle/[id]`, `PATCH /api/lifecycle/tasks/[taskId]` | |

Decisions worth keeping:

- **A journey cannot close over an outstanding mandatory task.** Checked
  against the rows under `FOR UPDATE`, not against what the client last saw —
  two people pressing Complete at once would otherwise both read an incomplete
  list and both pass. An exit recorded as clean while access is still live is a
  wrong answer to the question an audit asks.
- **The refusal names what is missing.** `blockingTasks` returns the tasks
  rather than a boolean, because "you cannot finish this" is not useful without
  "because these three things are not done". The page shows it inline.
- **`completed` and `completed_at` are written together**, enforced by a CHECK
  constraint. A clearance that looks done with no record of when or by whom
  answers nothing.
- **Progress never rounds up to 100.** 199 of 200 tasks rounds to 100 and reads
  as finished; anything short of every task now caps at 99.
- **Checklists are created on first tick**, not up front, so listing every
  leaver does not write a row for each of them before anyone has done anything.
- **Tasks load in one query, not one per journey.** The per-journey version is
  an N+1 that only appears once a customer has more than a handful of leavers.

`npm run db:verify:modules` grew to **36 checks**, covering the two unique
constraints (one journey per kind per person; one task key per journey), both
completion-consistency constraints, and tenant isolation on both tables.

### Payroll could not run at all

Reported from production with a screenshot: "Failed to generate payroll", and
every KPI card reading ₹0.0L.

Both symptoms were one bug. The page went through
`genericService(COLLECTIONS.payroll)`, which resolves an endpoint in two steps —
a lookup in `ENTITY_ROUTES` for collections with a real table, falling back to
`/api/collections/<name>` for the free-form document store. **`payroll` was in
neither.** No entity route, and `ALLOWED_COLLECTIONS` deliberately excludes it,
with a comment saying exactly why:

> "Only the free-form collections live here. Employees, leave, payroll and the
> rest have their own tables and their own routes; routing them through a
> schemaless store as well would give the same records two homes and let them
> drift apart."

So every read and every write returned `404 Unknown collection "payroll"`. The
list failed, which is why the KPIs showed zero; the insert failed, which is why
Run Payroll showed a red toast. Neither half of the routing was wrong on its
own — nothing stopped a page asking for the combination.

The document store was right to refuse. `/api/payroll/*` and `payroll.neon.ts`
already existed and are considerably better than what the page was doing for
itself:

| The page's own arithmetic | The repository |
|---|---|
| `hra = basic * 0.4`, `tax = gross * 0.1` | Statutory PF with the ₹1,800 cap, ESI against the ₹21,000 ceiling, professional tax by slab, new-regime TDS |
| Floats | bigint minor units |
| Wrote `status: "draft"` per payslip | draft → processing → processed → approved → paid, with a maker-checker CHECK constraint so the processor cannot approve their own run |
| Ignored attendance | Prorates for loss of pay |

Fixed by adding `src/lib/payroll-client.ts` and routing the page through the
real API. Three further defects surfaced while doing it:

- **The catch swallowed the reason.** `catch { toast.error("Failed to generate
  payroll") }` is why a 404 from the wrong endpoint reached a user as four
  useless words. The server's own message is now shown.
- **A failed load rendered as an empty payroll.** Conflating "nothing came
  back" with "there is nothing" is what let a total failure look like a fresh
  install inviting you to run payroll. A failed load now says so.
- **The status action defaulted to `"pay"`.** The lifecycle is
  processed → approved → paid, and the mapping fell through to `pay` for any
  unrecognised status — the worst available default in a file that releases
  money. Now mapped explicitly, refusing anything it does not recognise.

Also: the table's buttons passed the **payslip** id where the API expects the
**run** id. The lifecycle acts on a whole period, not one person's payslip, so
each row now carries its `runId`.

`src/lib/payroll-client.test.ts` pins the gap so it cannot reopen: `payroll` is
asserted absent from `ALLOWED_COLLECTIONS`, alongside the other owned tables,
and the month conversion is checked to be 1-based — `Date` months are 0-11 and
`periodMonth` is 1-12, and mixing them runs December's payroll into November.

### Fabricated data removed from the portal

Audited with `scripts/audit-fabricated-data.ts`, which separates a *constant*
from a *fabrication*. A list of Indian state names is a constant. A hardcoded
PAN rendered under the heading "PAN Number" is a fabrication: it looks like a
fact about the person on screen, and nobody reading it can tell otherwise.

**The HR Assistant was inventing facts about people and citing sources for
them.** Asked "What is my leave balance?" — a question it offered as a
suggestion chip — it answered:

> 🟢 **Casual Leave**: 6 remaining (12 total, 4 used, 2 pending) … You have a
> total of **36 leave days** remaining this year.
>
> _Sources: Leave Management System, HR Policy v3.2_

None of it had been read. The same page reported a fabricated performance
rating — *"Final Rating: 4.1/5 (Exceeds Expectations)"* — a made-up learning
budget with a remaining figure, and training "recommended based on your role".
It waited 800–2000ms before answering to look like it was thinking.

An employee plans a holiday around a leave balance. This was the worst defect
in the product: linked from the main navigation, actively inviting the
question, and answering with the confidence of a system that had looked it up.

Rebuilt as `src/lib/assistant.ts` (23 tests) on one rule: **never state a fact
about a person that has not been fetched.** Answers are now one of three kinds:

| | |
|---|---|
| `fetched` | Real data, read when the question is asked. Leave balances (`/api/leave/balances`) and holidays (`/api/holidays`) qualify. Only these carry a source. |
| `navigation` | "Here is where that lives", with a link and **no figures** — a test asserts no currency amount, percentage, day count or `n/5` rating appears in any of them. |
| `unknown` | "I do not have an answer for that", with a route to someone who does. |

Policy figures are deliberately *not* recited. Approval limits and notice
periods are per-organization configuration, and one quoted confidently from
memory is how somebody files a claim that gets rejected. A failed fetch says
so rather than falling back to a plausible number — that fallback is precisely
what made the old version dangerous.

A test caught a real bug during this: the suggestion chip *"How do I raise an
IT ticket?"* returned "I don't know", because the intent matched the phrase
`"raise a ticket"` and the chip says `"raise an IT ticket"`. A chip that
produces a shrug is worse than no chip.

**`/employees/profile` was an entire fabricated person.** 552 lines, no data
source of any kind: "Aarav Sharma", a valid-format PAN, a masked Aadhaar, a
passport number, home and permanent addresses, a ₹18.5L salary with a revision
history, and two emergency contacts with phone numbers — all rendered under
real labels. It was linked from nowhere and absent from the navigation, and
`/myprofile` already does the same job from `useAuth` and the real stores.
Deleted rather than rewired.

`npm run audit:fabricated` runs in `verify` and CI. It is proven non-vacuous:
planting one of each class — a PAN, an `@example.com` address, a `Math.random()`
metric and a `MOCK_` constant — makes it fail. It exempts skeleton-loader
shimmer widths by looking at the enclosing function rather than the line, and
strips comments before scanning, because several comments legitimately describe
these patterns while explaining a past fix.

### Every dashboard page's data path now resolves

`scripts/audit-data-paths.ts`, written after payroll and employees were both
reported broken, checks all 90 dashboard pages for the shape both shared: a
page asking for a collection that nothing serves.

`genericService(COLLECTIONS.x)` resolves in two steps — `ENTITY_ROUTES` for
collections with a table, falling back to `/api/collections/<x>` for the
document store. A collection in **neither** 404s on every request, and the page
renders an empty state, because a failed load and an empty result look
identical.

It found **12 broken paths across 5 collections**:

| Collection | Pages | Resolution |
|---|---|---|
| `announcements` | dashboard, announcements, admin | Real table, no route — built `/api/announcements` |
| `holidays` | holidays, hrcalendar | Real table, no route — built `/api/holidays`. A holiday list that silently comes back empty is what leave, payroll working days and attendance are all counted against. |
| `departments` | departments, orgchart, orghealth | Real table, no route — built `/api/departments` |
| `workflows` | workflows | Route existed, never registered |
| `payroll` | payroll, payslip, compensation | Has a run-based API that a flat collection cannot express; pages now use `payroll-client`. `compensation` was syncing it and never reading it — dead code, removed. |

All four new routes are registered in `ENTITY_ROUTES`, and the audit runs in
`verify` and CI so the next one fails at the gate rather than in production.

### The notification bell was eight invented entries

You were right to push on this after the first pass reported zero findings —
the audit had a blind spot, and it was hiding the thing you had asked about
twice.

`DEMO_NOTIFICATIONS` in `notification-center.tsx` rendered the same eight
entries to every user of every tenant:

> "Riya Gupta requested 3 days sick leave" · "March 2026 payroll has been
> processed for 1,248 employees" · "Sarah Chen applied for Senior Full Stack
> Developer" · "Amit Shah submitted ₹12,500 expense for approval"

None of those people exist in any customer's organisation. The unread badge
read **3** for everybody, permanently — visible in the screenshot from the
employees bug report.

The audit missed it for an instructive reason: the prefix list was
`MOCK_|DUMMY_|FAKE_|SAMPLE_|SEED_` and the constant was called `DEMO_`. **An
allowlist of prefixes only ever catches the prefixes somebody thought of.** So
the rule that matters now is structural rather than lexical: a module-level
array of objects each carrying an `id` and values that could only belong to
somebody — an amount, a date, a "5 min ago" — is a table of rows typed into
the source, whatever it is named.

Separating that from a legitimate *catalogue* is the hard part. The product
rightly ships lists of what it offers: report templates, letter templates, the
modules in settings, supported integrations. Those describe the product; the
fabrications describe a tenant. The signal is the tenant-shaped value — a
catalogue entry has a key, a label and a description, and no ₹12,500. Proven
both ways: a probe containing a fabricated notification set *and* a report
catalogue side by side reports the first and ignores the second.

`GET /api/notifications` replaces it, deriving from work that is genuinely
outstanding and scoped to the caller's permissions: leave and expenses awaiting
their decision, approved expenses not yet reimbursed, overdue lifecycle tasks,
and exit clearances still open after someone's last day. Everyone additionally
sees their own pending requests.

Three decisions worth keeping:

- **No notifications table.** A notification here is a *view over current
  state*, not a stored event, so it cannot go stale, cannot be delivered twice,
  and cannot outlive the thing it refers to being resolved by somebody else.
  The cost is that "mark as read" is per-session — a bell that clears when the
  work is done beats one that clears when you glance at it.
- **Counts, not names.** "6 leave requests need your decision" is a prompt;
  eight rows naming individuals is a list, and the page it links to is where a
  list belongs, with the access control that page already enforces.
- **No timestamps and no avatars.** Both were props of the hardcoded set and
  both were fiction. These describe work outstanding *now*, so there is no
  moment to stamp.

A failed fetch is distinguished from an empty bell. "All clear" when nothing
was read is the same class of lie in miniature.

### `/tax` invented an employee's income and investments

335 lines with no data source. `GROSS_INCOME = 1800000` was rendered under
"Gross Income" as the reader's own salary. Twelve `DECLARATIONS` listed
investments they never made, with amounts — ₹72,000 of PPF, ₹50,000 of ELSS, a
₹24,000 life insurance premium. Twelve months of TDS and three prior years of
tax paid were equally invented, and the "tips" were computed from the fiction:
*"Maximize your 80C limit — you have room for an additional ₹2,400."*

This is a page people file taxes from.

Gross income and TDS genuinely exist — they are on every payslip — and are now
summed from the real ones via `/api/payroll/payslips`. Declarations have no
storage anywhere in the product, so they show as empty rather than invented.
The statutory section limits stay: those are facts about Indian tax law, not
about any employee. The tips are now impersonal guidance.

One deliberate imprecision, stated rather than hidden: the payslip DTO does not
break TDS out from other deductions, so the chart shows total deductions.
Labelling that "TDS" would be the same confident wrongness in a new place.

### `/billing` showed four invoices nobody received

Marked paid, denominated in **dollars** on a product whose every other amount
is rupees — a fair sign of where they came from. There is a `subscriptions`
table but no invoice table, so the list is now empty. An empty list under a
heading is honest; four fabricated receipts are not.

### Known, not yet fixed

| Issue | Where |
|---|---|
| ~925 lint warnings (`no-explicit-any`, `no-console`) | Repo-wide. Informational; `lint:strict` holds new code to zero. |
| **`bank_details` is not encrypted**, unlike the other sensitive columns. | `src/db/schema/hrms.ts`. It is `jsonb`, so holding a ciphertext string needs a type change and a migration rather than the backfill the `text` columns use. Nothing writes to it today. |

### MFA could not be turned on

Multi-factor authentication was, in practice, a dead feature. Everything around
it existed and worked: `verifyTotp`, `generateBackupCodes`, `consumeBackupCode`,
lockout counting a wrong second factor, `login_lookup` carrying `mfa_secret`,
and both mobile clients sending `totpCode` on sign-in. **There was no enrolment
route.** `createTotpEnrolment` was called only from tests, so nothing could ever
set `identity.users.mfa_secret` — a control the code itself calls "a baseline
requirement" for enterprise buyers could not be enabled by anyone.

Closing it needed a state distinction that did not exist. A secret is written
the moment a QR code is displayed, which is well before the user has proved
they can read it; enforcing from that instant locks out anyone whose camera
failed, whose clock is skewed, or who simply closed the tab — and the only way
back is an administrator disabling MFA out of band, which is its own attack
path. So:

| State | Columns | Sign-in |
|---|---|---|
| `off` | no secret | not enforced |
| `pending` | secret, `mfa_enabled_at` null | **not enforced** |
| `active` | secret + `mfa_enabled_at` | enforced |

`0025_mfa_enrolment.sql` adds `mfa_enabled_at` to `identity.login_lookup`; the
sign-in path had no way to tell the states apart and keyed off `mfa_secret`
alone. (Appended last in the view, because `CREATE OR REPLACE VIEW` may only
add columns at the end — inserting one renames those after it and Postgres
refuses.)

The rule lives in `src/lib/auth/mfa-enrolment.ts` (15 tests) rather than in the
route handlers, so `mfaRequiredAtSignIn` is stated once and pinned. New routes:

| Route | Behaviour |
|---|---|
| `GET /api/auth/mfa` | off / pending / active |
| `POST /api/auth/mfa` | Mints a secret, stores it encrypted, returns the `otpauth://` URI once. Refused while active — overwriting a live secret invalidates the authenticator the user still depends on. |
| `POST /api/auth/mfa/confirm` | Verifies a live code, *then* activates and issues backup codes. Codes are issued at activation, never for a secret that turns out not to work. |
| `DELETE /api/auth/mfa` | Requires the password **and** a current code — a stolen session must not be able to remove the control that exists to contain it. One error message for either failure, so it cannot be used as an oracle. Clears the backup codes with the secret. |

All four are scoped to the caller's own account; there is no `userId`
parameter, so "disable MFA" is not reachable for someone else with an ordinary
session.

**The web sign-in page could not accept a code.** Building the API only moved
the dead end: `login/page.tsx` read `mfaRequired` from the response and showed
a toast saying *"Enter your two-step verification code to continue"* — with no
field to enter one, and no way to send a recovery code either. Turning MFA on
from the web would have been an unrecoverable lockout. Both mobile clients
already handled this correctly; only the web page did not.

Two details there are worth keeping:

- The second-factor step is **sticky**. A wrong code returns `mfa_invalid`, not
  `mfa_required` — the server has already accepted the password and is
  answering a narrower question — so deriving the step from the latest response
  would drop the field the moment someone mistyped, which reads as "my password
  stopped working".
- Focus moves to the field via a ref in an effect rather than `autoFocus`,
  which `jsx-a11y/no-autofocus` correctly rejected. `autoFocus` fires on mount
  and steals focus before anything has been read; moving it when the step
  appears is the deliberate version, and without it a keyboard user is left at
  the bottom of a form whose new field appeared above them.

`src/components/two-factor-settings.tsx` is the enrolment UI, on the settings
Security tab. It renders the QR client-side from the `otpauth://` URI (via a
dynamically imported `qrcode`) rather than accepting an image from the server,
so the secret never lands in an `<img src>` that a browser might cache or log;
the manual key beside it is a complete fallback, and the QR carries `alt=""`
because it duplicates that text. The pending state is shown rather than hidden
— someone who abandons enrolment and returns should see "you started this"
instead of a second QR code and no idea which of two authenticator entries is
real.

`mobile/app/two-factor.tsx` is the same flow for Expo, with one deliberate
difference: **no QR code.** The phone is usually the authenticator, and you
cannot scan your own screen. It opens the `otpauth://` URI with `Linking`
instead — that is the scheme every authenticator registers, so the secret is
handed over with nothing to type — and falls back to a selectable key when no
app claims it. Recovery codes are rendered `selectable` rather than behind a
copy button, which is the gesture people already use and avoids a clipboard
dependency for one screen.

`MobileApiClient.delete` gained an optional body so "turn off" can carry the
password and code that authorise it. The alternative was query parameters,
which would put a password in every access log between the phone and the
server.

### Encryption at rest — implemented

`ENCRYPTION_KEY` was documented in `docs/DEPLOYMENT.md`, and both
`identity.users.mfa_secret` ("encrypted at rest") and `TotpEnrolment.secret`
("to persist (encrypted)") described it as already happening. It was not: the
variable was read nowhere and every column was plaintext.

`src/lib/crypto/field-encryption.ts` (26 tests) is AES-256-GCM with a
`enc.v1.<keyId>.<iv>.<ciphertext+tag>` envelope. GCM because it authenticates —
a tampered value fails to decrypt rather than yielding plausible garbage. A
random 96-bit IV per encryption, which GCM requires; the consequence is that an
encrypted column cannot be searched, indexed or made unique, which is fine for
all of these (none is indexed) and is the reason a blind index would be needed
before encrypting anything that is.

Two decisions carry the deployment:

- **Plaintext reads pass through unchanged.** Without that, switching
  encryption on locks out every user already enrolled in MFA. Only this
  module's writes produce ciphertext, so a bare value means "not yet
  backfilled", never "downgraded by an attacker".
- **The key id is in the envelope.** Rotation otherwise means trying every key
  and treating failure as "wrong key" — indistinguishable from "corrupted row"
  at exactly the moment the ambiguity is least welcome.
  `ENCRYPTION_KEY_PREVIOUS` holds retired keys decrypt-only.

**A real bug was caught by verifying against a database rather than a mock.**
`scripts/encrypt-fields.ts` re-encrypted `row.value` directly. On the first run
that is correct, because the value is plaintext. On a *rotation* the value is
already an envelope, so it was wrapped a second time — the row then needed two
decryptions to read, one with a key about to be retired. Every enrolled user
would have been locked out, and it would only have surfaced at their next
sign-in. The fix is to `decryptField` first, which is a no-op on plaintext and
unwraps the retired key otherwise. `npm run db:verify:encryption` (13 checks
against PGlite) exercises that path and now runs inside `npm run verify`, since
it is not a mistake a unit test catches.

### Security review

A full review was run against cross-tenant leakage, broken access control,
authentication, injection and secrets. **One exploitable defect was found.**

**Managers could read every employee's salary** — `src/app/api/employees/route.ts`
and `src/app/api/employees/[id]/route.ts`. Both gated on a hardcoded role array
(`["owner","admin","hr","manager"]`) and then returned the record verbatim,
including `salary`. So any manager-role session could issue
`GET /api/employees?pageSize=500` and harvest the whole organisation's
compensation.

RLS does not help here: it isolates tenants, and this is the manager's own
tenant's data. The permission model is what was supposed to stop it —
`MANAGER_PERMISSIONS` deliberately omits `payroll.view`, because a reporting
line is not authority to see someone's pay — and three sibling code paths get
this right, which is what proves it was a defect rather than a decision:
`employees/[id]/direct-reports` strips salary for everyone, `reporting/builder`
gates the `ctc` column behind `payroll.view`, and `payroll/payslips` restricts
to `["owner","admin","hr"]`.

The root cause is visible in the old comment — *"Managers and above get the full
directory"* — which conflated **directory access** with **salary access**.

Fixed by asking the permission model instead of re-deriving it per route:

- `roleHasPermission(role, permission)` in `rbac.ts` bridges the API layer's
  `owner` role, which `ROLE_PERMISSIONS` has no entry for. Passing `"owner"`
  straight to `hasPermission` returns `false` and denies the most privileged
  account in the organisation — a trap now pinned by a test.
- `canViewOthersSalary(role)` states the rule once. Both routes call it; a
  caller still always sees their own pay.
- 7 new tests in `rbac.test.ts` pin the boundary and assert the helper tracks
  the permission model rather than a role list.

Clean in every other category: no cross-tenant leakage (every org-scoped query
runs under `withTenant`, RLS is `FORCE`d so it covers the table owner, and
`app_current_org()` returns NULL when unset so an unscoped query denies rather
than leaks); no SQL/XSS/SSRF injection reachable from user input (the reporting
builder allowlists columns and binds parameters, `sql.raw` is used once against
a hardcoded whitelist, and `document-rules.ts` escapes every token value); no
authentication weaknesses (HS256 with org/role/session validation, refresh-token
rotation with family-wide revoke on replay, Argon2id, lockout); no committed
secrets and no secret behind a `NEXT_PUBLIC_` prefix.

### Money now leaves the API exactly — fixed

`toMajor` in `payroll.neon.ts` did `Number(minor) / 100`, against the codebase's own rule that
payroll must never touch floating point. The type comment said the result "must never be summed or
compared for equality on the client" — a rule a type cannot enforce and a reviewer has to remember,
and it **was already being broken**: `payroll/page.tsx` reduces every payslip's net pay into the
headline "Net Payroll" KPI, and `payslip/page.tsx` does the same for YTD totals.

Two separate errors were in play, and only one of them is rounding:

- **Addition drifts.** `0.1 + 0.2` is `0.30000000000000004` before anything rounds it. Over a few
  thousand payslips that is a reconciliation finance cannot close.
- **Large totals lose whole paise.** A `Number` cannot represent every integer past 2⁵³ paise
  (≈ ₹90,071,992,547,409). Formatting `90071992547409.91` from a float prints `…409.90`.

Fixed by adding `src/lib/money/minor.ts` (38 tests) and carrying minor units through the DTOs:

| Added | Purpose |
|---|---|
| `parseMinor` / `toMinor` | bigint ↔ string, since JSON has no bigint |
| `sumMinor` / `subtractMinor` | The operations the float version got wrong |
| `minorToDecimalString` | Exact `"123456789"` → `"1234567.89"`, by bigint division |
| `minorToMajor` | The old float conversion, kept for printing a single value |
| `formatMinor` | Formats without ever creating a float, using `Intl.NumberFormat`'s ES2023 string argument — with a capability check, because an engine without it would render "NaN" where a salary belongs |

`PayrollRunRecord` and `PayrollRecordDto` now carry `totalGrossMinor` / `grossMinor` and siblings
next to the existing floats, so nothing had to be rewritten to keep working and anything that needs
to be exact now can be. The Expo and Kotlin payslip DTOs carry them too. The two remaining
`Number(x) / 100` conversions — feeding gross and CTC into the professional-tax and income-tax slab
functions — go through `minorToMajor`, so the value reaching a slab boundary is the nearest double
to the real amount rather than the result of a float division that may already have drifted across
it.

### Accessibility defects in the shared palette

Found while converting the web tokens (`src/app/globals.css`, oklch) to sRGB for React Native,
then measured properly with `src/lib/color/contrast.ts`. **All fixed.**

The first pass found four. Checking every pair the app actually renders found **fifteen** — which
is the argument against writing this kind of thing down instead of fixing it.

| Pair | Measured | Required | Consequence |
|---|---|---|---|
| Dark `--card` on `--background` | **1.04:1** | — | The card is not visibly there. Every grouped surface in dark mode was invisible. |
| Light `--border` on the page | **1.27:1** | 3:1 | An input outline nobody can see — the only thing marking where a field begins. |
| Dark `--border` on `--card` | **1.24:1** | 3:1 | As above, in dark mode. |
| White on `--success` | **3.03:1** | 4.5:1 | Two thirds of what it needs, on every approved and paid state. |
| White on dark `--primary` | **3.60:1** | 4.5:1 | Every primary button label in dark mode. |
| Dark `--muted-foreground` on `--muted` | **3.73:1** | 4.5:1 | Every date, caption and helper line. |
| White on `--destructive` | **4.10:1** | 4.5:1 | The delete button — the one you least want misread. |
| Light `--accent-foreground` on `--accent` | **4.43:1** | 4.5:1 | Selected and emphasised regions. |

Three of the fixes are judgement rather than arithmetic, and are commented in `globals.css`: the
light page is no longer pure white (a white page cannot show a white card); dark primary buttons
take a dark label rather than white (a light accent on a dark surface is the case for dark text);
and borders are heavier than the current fashion, deliberately.

`src/lib/color/web-palette.test.ts` parses the real stylesheet and asserts every pair, so this
cannot regress. `mobile/src/theme/tokens.test.ts` does the same for the app palette. Both import
one contrast implementation from `src/lib/color/contrast.ts` — a second copy would let the two
products disagree about whether a colour is readable.



### 2.4 Production-grade UX

| Task | Detail |
|---|---|
| **Design system pass** | Formal tokens (primitive → semantic → component), consistent density, dark-mode contrast audit. Runs through `ui-ux-pro-max` `--design-system`. |
| **WCAG 2.2 AA** | Colour: **done and enforced** (`src/lib/color/web-palette.test.ts` asserts every pair against the real stylesheet). Keyboard and roles: **done and enforced** (`npm run lint:a11y`, jsx-a11y recommended at zero). Remaining: focus-visible styling audit, heading order, live-region coverage, and a screen-reader pass on the 10 heaviest routes — none of which static analysis can confirm. |
| **Performance** | Virtualised tables, server-side pagination, streaming SSR, route-level code splitting, bundle analyser gate. Target: LCP < 2.5 s, CLS < 0.1, INP < 200 ms. |
| **Command palette everywhere** | `cmdk` already present — extend to global actions, not just navigation. |
| **Empty / loading / error states** | Every one of the 92 modules gets all three, properly. |
| **Onboarding tours** | Contextual product tours per role. |

**Exit criteria:** workflow engine, report builder, notification engine, public API, SSO/SCIM, and
the AI copilot shipped; WCAG 2.2 AA verified; Core Web Vitals green on the 10 heaviest routes.

---

## Phase 3 — Mobile Apps

One Expo/Turborepo monorepo, six apps, one shared design system — templated from the existing
`WebSite/mobile` Expo app.

### 3.1 Shared foundation

| # | Task | Status |
|---|---|---|
| 3.1.5 | Offline sync engine with conflict handling — `src/lib/mobile/offline-queue.ts` | ✅ |
| 3.1.3 | Typed API client with single-flight token refresh — `src/lib/mobile/api-client.ts` | ✅ |
| 3.1.8 | Geofence evaluation shared by phone and server — `src/lib/mobile/geofence.ts` | ✅ |
| 3.1.9 | Expo app scaffold under `mobile/`, sharing the core via `@shared/*` | ✅ |
| 3.1.10 | Design tokens with an enforced WCAG contrast contract — `mobile/src/theme/` | ✅ |
| 3.1.4 | `expo-secure-store` token storage, `expo-sqlite` queue storage | ✅ |
| 3.1.2 | Accessible primitives — `Button`, `TextField` | ✅ |
| 3.1.11 | Session and sync providers, auth gate, sign-in | ✅ |
| 3.1.12 | Clock in/out with device-side geofence pre-check and offline queueing | ✅ |
| 3.1.13 | Leave list, balances, apply form, request detail | ✅ |
| 3.1.4b | Biometric unlock (`expo-local-authentication`) | ✅ |
| 3.1.14 | Refused-work visibility with explicit retry and discard | ✅ |
| 3.1.15 | Settings screen | ✅ |
| 3.1.6 | `packages/push` — Expo Notifications registration and handling | ⏳ |
| 3.1.16 | Payslip list and detail, with tested money and period formatting | ✅ |
| 3.1.17 | Manager approvals inbox (online-only, by design) | ✅ |
| 3.1.18 | Bottom tab navigation — Today, Leave, Shifts, Pay, Profile | ✅ |
| 3.1.19 | Shared UI primitives — `Screen`, `Card`, `Banner`, `StatusPill`, `EmptyState`, `Skeleton`, `AppText` | ✅ |
| 3.1.20 | My shifts, over `/api/roster/my-shifts` — published rosters only | ✅ |
| 3.1.21 | Attendance history and monthly summary, over `/api/attendance` | ✅ |
| 3.1.22 | Profile screen, and an error boundary with a way out | ✅ |
| 3.1.23 | Text that survives the OS text-size setting — `lib/type-scale.ts`, applied in `AppText` | ✅ |
| 3.1.24 | Helpdesk — list, raise and reply, over `/api/helpdesk` | ✅ |
| 3.1.25 | Tab routing rule extracted to `lib/navigation.ts` and tested without a device | ✅ |
| 3.1.7 | EAS Build + Submit pipelines; OTA updates via EAS Update | ✅ config, ⏳ first build |
| 3.1.26 | Play Store release preparation — listing, data safety, generated assets, runbook | ✅ |
| 3.1.1 | Turborepo workspace, once a second mobile app exists | ⏳ |

The Expo app lives at `mobile/`. It is a separate package with its own `tsconfig.json` and
`node_modules`, and it is typechecked by `npm run verify` through `scripts/typecheck-mobile.mjs`
(which skips with a message if its dependencies are not installed, so web-only work does not
require a React Native install).

The platform-neutral core — API client, offline queue, geofence — stays in `src/lib/mobile/` and
is imported as `@shared/*`. Shared rather than copied: there were briefly two geofence
implementations with different Earth radii, and they disagreed about whether someone standing at
the edge of an office was at work. **The `@shared/*` alias must be declared in both
`mobile/tsconfig.json` and `mobile/metro.config.js`** — with only the first, typechecks pass and
the app crashes at runtime.

`mobile/src/theme/tokens.test.ts` asserts a contrast ratio for every colour pair the app uses, so
a palette tweak that drops below WCAG AA fails `npm run verify` and names the pair.

Background location is blocked outright in `app.json`. An HR app that can follow staff home is a
surveillance tool, and the only credible promise that it does not is one the OS enforces.

**Not done:** push notifications and EAS build configuration. The web app builds
cleanly (`npm run build`, 176 pages) and the Expo app typechecks, but **neither has been run
against a real Neon database, and the mobile app has never been run on a device.** Compiling is
not the same as working.

### Defects found while building the mobile screens

| Defect | Consequence had it shipped |
|---|---|
| **The leave list had no loading state.** Its first render reached the empty branch and said "You have not applied for any leave yet" before the request returned. | A statement about someone's record that nothing had checked, and indistinguishable from the truth. Somebody whose approved leave failed to load is told they never applied — and the reasonable response to that is to apply again. Same defect as `/api/helpdesk` returning `data: []` after authenticating. |
| **`/api/attendance` filters on `employeeId`, and for a privileged caller omitting it means *no filter*.** | A manager opening their own attendance history would have been shown the whole organisation's punches with no names attached. The screen now always sends its own id. |
| **`isOvernight` compared UTC instants in its first test.** | The test passed in London and failed in Bengaluru: 22:00Z and 06:00Z the next day are the same local date in IST. The question — do I go home tomorrow — is a local-calendar question, so the fixture is built from local time and the assertion holds anywhere. |
| **`Skeleton` held its `Animated.Value` in `useRef(...).current`.** | Caught by `react-hooks/refs` once `mobile/app` and `mobile/src/components` were added to `lint:strict`. Reading a ref during render is a side effect; the value can belong to a render pass that never commits. The same shape as the `useIntersectionObserver` and `useInterval` defects fixed in Phase 1. |
| **`leave/apply` rebuilt its `draft` object every render** and listed it in a `useCallback` dependency array. | The submit handler's identity changed on every keystroke, so the memoisation did nothing and the handler was replaced under the finger mid-tap. |
| **Every screen clipped its text at large OS text sizes.** React Native scales `fontSize` for the accessibility setting and leaves `lineHeight` alone, and the theme states line heights in absolute points — as it must, since React Native's `lineHeight` is points and not a ratio. At 200%, body text is 30-point glyphs on a 22-point line. | Descenders go first, then whole rows. It fails WCAG 1.4.4 at about 130%, and it fails it for exactly the people who changed the setting because they were already struggling to read it. Fixed in one place — `AppText` — so every screen inherits it; `mobile/src/lib/type-scale.ts` pins the invariant that whatever multiplier the glyphs get, the line gets. A *capped* line height would have been worse than doing nothing, because it guarantees the overlap rather than merely permitting it. |
| **`resolveBaseUrl()` named an environment variable nothing read.** Its error message told you to set `EXPO_PUBLIC_API_BASE_URL`; the function only ever looked at `expo.extra.apiBaseUrl`. | Anybody who followed the instruction in the error set the variable and got the identical error back. It also made per-profile API URLs impossible, which is the whole mechanism by which a preview build is kept away from the production database. Found while writing `eas.json`, which needs exactly that variable to work. |
| **The privacy policy named Firebase as the processor** for authentication, database and storage, months after Firebase was removed from the product. | A false statement about where personal data is held, on the page a Play reviewer reads before approving a listing that collects location. |

`mobile/app` and `mobile/src/components` are now inside `lint:strict` at zero warnings, which is
how the last two were found.

Biometric unlock gates an *existing* session and is not a sign-in method. A local biometric proves
the holder is the enrolled person and proves nothing to the server, which has never seen the face;
the credential that authenticates is still the refresh token in the keystore. Treating a local
biometric as authentication makes the phone the authority, and bypassing the prompt on a rooted
device is a solved problem.


### 3.2 App rollout order

| Order | App | First-release scope |
|---|---|---|
| 1 | **HRMS** | Punch in/out (geofence + selfie), leave apply/approve, payslips, attendance history, approvals inbox, directory, announcements, expense capture with receipt OCR, holidays, profile |
| 2 | **Mail** | Inbox, threads, compose, attachments, push, offline drafts, swipe actions |
| 3 | **CV-365** | Docs viewer/editor, drive, tasks, calendar |
| 4 | **ATS** | Recruiter pipeline, interview feedback capture; separate candidate-facing app |
| 5 | **Office** | Admin console, approvals, dashboards |
| 6 | **WebSite** | Fold the existing consumer/IoT app into the monorepo |

### 3.3 Mobile quality bar

Enforced from `ui-ux-pro-max/references/pro-rules.md`:
- 44×44 pt minimum touch targets, ≥ 8 pt spacing
- Offline-first with optimistic UI and visible sync state
- Biometric gate on payroll/PII screens
- Safe-area-aware layouts (notch, home indicator, keyboard avoidance)
- 150–300 ms transitions; `prefers-reduced-motion` honoured
- Light + dark themes both contrast-audited
- Screen-reader labels on every interactive element; no icon-only buttons without labels
- Deep linking + predictable back behaviour
- Bottom nav ≤ 5 items

**Exit criteria:** HRMS and Mail apps live on App Store + Play Store; offline attendance verified
in airplane mode; push delivery > 99%; crash-free sessions > 99.5%.

---

## Cross-Phase Standards

**Definition of Done** — every task:
1. TypeScript strict, no `any`
2. Unit tests for logic, E2E for the critical path
3. Zod validation on every input boundary
4. RLS + RBAC enforced server-side, never only client-side
5. Loading, empty, and error states implemented
6. Keyboard accessible, screen-reader labelled
7. Structured logging with a request ID
8. Documented in `docs/`
9. Reviewed on `develop` before `main`

**Environments**

| Env | Branch | Neon | Host |
|---|---|---|---|
| Local | any | local branch | `next dev --turbopack` |
| Preview | PR → `develop` | ephemeral branch per PR | Vercel preview |
| Staging | `develop` | `staging` branch | `*-staging.circuvent.com` |
| Production | `main` | `main` branch | `*.circuvent.com` |

---

## Immediate Next Actions

**Blocked on credentials:**
1. **Create the Neon project** and the six schemas — requires a Copilot CLI restart so the Neon MCP
   tools load, then `npm run db:migrate` against the new branch.
2. Vercel projects, GoDaddy DNS cutover, Oracle VM provisioning, backups.

**Unblocked, in order of value:**
3. Expo app shell: Expo Router, secure token storage, biometric unlock, and the first screens
   (punch in/out, leave, payslips) over the client and queue already built.
4. Workflow designer UI over `/api/workflows` and the definitions schema.
5. Report designer UI over `/api/reports/fields` and `/api/reports/run`.
6. SSO (SAML/OIDC) and SCIM protocol handlers over the existing schema.
7. Wire the notification engine into leave, expense and payroll events.

---

## Fabricated data: the audit was scanning two directories out of nine

The notification bell was reported as still showing invented data after the fix. It was not: the
component had been rewritten and the source was clean. What the report exposed was that
`audit-fabricated-data.ts` scanned `src/app/(dashboard)` and `src/components` only, so anything one
import upstream of a page was invisible to it. Scanning the components but not the hooks and stores
that feed them checks the plate and not the kitchen — a page comes out clean precisely because the
fabrication moved.

Widening `ROOTS` to all of `src` found, in code the audit had never read:

- **`src/hooks/use-dashboard.ts`** — nine hooks (`useLeaveSummary`, `usePayrollSummary`,
  `useRecruitmentSummary` and six more) each returning a complete invented module summary: pending
  counts, leave calendars, attrition rates, named employees. Imported by nothing, which is the only
  reason no screen showed them. Deleted; dead code that fabricates is worse than dead code, because
  the next person to wire it up inherits a dashboard that lies.
- **`src/stores/extended-stores.ts`** — `useSearchStore.search()` awaited a 200 ms timer commented
  "simulate search delay" and returned three invented people. Deleted.
- **`src/lib/validations.ts`** — `generateEmployeeId()` returned `EMP` + a random four-digit number
  with no uniqueness check. That is 9,000 codes, so a collision is more likely than not at 112
  employees, on the key half the system joins people by. Unused; removed rather than repaired,
  since a real one has to come from a per-tenant database sequence.
- **`src/app/page.tsx`** — three invented customer testimonials with names, job titles, named
  employers and five-star ratings, plus "500+ Companies Trust Us" and "50K+ Employees Managed" on a
  deployment whose payroll had never run. This is a different category from the rest: a placeholder
  leave balance misleads one tenant, a fabricated endorsement attributed to a named person is a
  false endorsement under both the ASCI code and the FTC endorsement guidelines. Removed. The
  remaining figures are each checkable against this repository.

### Two defects in the audit itself

`stripComments` used `^\s*//`, and `\s` matches newlines — so a blank line before a comment was
consumed along with the comment, collapsing lines and shifting every subsequent line number. It
reported a retry backoff at line 105 of a file that holds a header literal at 105. An audit that
points at innocent code is worse than one that stays quiet, because the next person learns to
distrust it. Fixed to `[^\S\n]*`, and the probe now asserts exact line numbers.

Exemptions were being tested against the stripped source, so a comment explaining *why* a value is
deliberately fake could never excuse it. `DUMMY_HASH` — a real argon2 hash that sign-in verifies
against for unknown accounts, so a missing account costs the same time as a wrong password — was
reported as sample data. Detection now reads the stripped source and exemption reads the raw
source, which is the right split: a comment must never create a finding, but a stated reason should
be able to clear one.

### New rules

- **`answers`** — a hook or function returning literal tenant values while calling nothing. This is
  the shape `findHardcodedRecordArrays` cannot see, because there is no array and the name is
  honest. Exempt when the function derives from its arguments: `useCountdown(targetDate)` initialises
  four zeros and then computes from the date it was handed, whereas `useLeaveSummary()` takes no
  arguments because there is nothing it could compute from.
- **`pretend`** — awaiting a timer to make a hardcoded answer feel like a round trip. Exempt for
  backoff, debounce, throttle and polling, which use the idiom for a real reason.

### Unrelated, found on the way

`getNewRegimeSlabs` and `getOldRegimeSlabs` were hand-typed copies of the slab tables in
`statutory-india.ts`. They agreed, which is what made them dangerous: Indian slabs move with every
Finance Act and the display copy is the one nobody remembers, so the portal would explain a
deduction it had not made. Both now derive from the tables and render byte-identically; a test pins
the exact strings, and changing a rate in the table fails it.

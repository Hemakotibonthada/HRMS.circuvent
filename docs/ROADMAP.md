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
| `startSync` set `loading: true` with no error path, so a permission or network failure left the UI spinning forever | `src/stores/unified-store.ts`, `src/lib/firestore-service.ts` | Fixed — added an `onError` channel |
| ESLint had never actually run: `FlatCompat` threw `Converting circular structure to JSON` against `eslint-plugin-react-hooks@7` | `eslint.config.mjs` | Fixed — use `eslint-config-next`'s native flat configs |
| `.firebase/` deploy output was being linted, producing ~44,000 spurious problems | `eslint.config.mjs` | Fixed — added to `ignores` |
| **44 pre-existing `react-hooks` errors**, incl. `Math.random()` / `Date.now()` called during render across 20 dashboard pages — a hydration-mismatch source | `src/app/(dashboard)/**`, `src/hooks/use-advanced.ts` | **39 fixed.** All purity, ref-during-render and set-state-in-effect errors resolved. 5 remain. |
| ~940 lint warnings (`no-explicit-any`, `no-console`) | repo-wide | ⏳ Phase 2.4 backlog |

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
| 1.6.7 | Retire Firebase Hosting | Only after 7 days of clean reconciliation |

**Exit criteria:** HRMS serves 100% of reads/writes from Neon on Vercel; Firebase removed from
`package.json`; CI green; payroll + RBAC + tenant-isolation tests passing; restore drill completed.

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
| **WCAG 2.2 AA** | Full audit + remediation; `eslint-plugin-jsx-a11y` enforced in CI. |
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
| 3.1.7 | EAS Build + Submit pipelines; OTA updates via EAS Update | ⏳ |
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

**Not done:** push notifications, payslips, shifts, an approvals inbox, and EAS build
configuration. No app has been run on a device — the app typechecks and its pure logic is tested,
but nothing here has been exercised against a real Neon database or a real phone.

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
7. Firebase Auth user import, then flip `DATA_BACKEND` to `dual`.
8. Wire the notification engine into leave, expense and payroll events.

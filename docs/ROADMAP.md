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

| Feature | Why it matters |
|---|---|
| **Visual workflow engine** | Drag-drop approval chains, conditional routing, parallel/serial approvers, delegation, SLA timers, auto-escalation, reminders. Every HR process becomes configurable instead of hard-coded. |
| **Custom fields & custom objects** | Per-tenant schema extension without a deploy. Non-negotiable for enterprise. |
| **Report builder** | Drag-drop dimensions/measures, saved views, scheduled delivery, XLSX/PDF/CSV export. |
| **Notification engine** | Multi-channel (email, SMS, push, WhatsApp, Slack, Teams), per-user preferences, digest batching, templating. Extends existing `notification-templates.ts`. |
| **Public API + webhooks** | Versioned REST, per-org API keys, scoped tokens, rate limits, OpenAPI spec, webhook subscriptions with retry + signature. |
| **SSO & SCIM** | SAML 2.0, OIDC, SCIM 2.0 provisioning, JIT user creation, IdP-initiated login. |
| **Feature flags per plan/tenant** | Ties directly to the existing `billing` + `subscription` modules. |
| **i18n & multi-currency** | `next-intl`, RTL support, per-org locale, multi-country payroll rules. |
| **Data governance** | GDPR/DPDP: DSAR export, right-to-erasure, retention policies, field-level encryption for PII, consent tracking. |
| **e-Signature** | Offer letters, policy acknowledgements, PIP sign-off — with audit trail. |
| **Bulk data operations** | Guided import with column mapping, dry-run validation, partial-failure reporting, rollback. |

### 2.2 AI layer ("the latest")

| Feature | Implementation |
|---|---|
| **HR Copilot** | RAG over company policies, handbook, and the employee's own records. Replaces the stub `chatbot` module. |
| **Resume parsing & ranking** | Structured extraction + semantic match against JD; feeds ATS. |
| **Attrition risk prediction** | Model over tenure, engagement scores, comp ratio, manager changes, leave patterns. Surfaces in `orghealth`. |
| **Survey sentiment analysis** | Theme extraction + sentiment on free-text feedback and exit interviews. |
| **AI drafting** | JDs, offer letters, performance review summaries, PIP plans, policy docs. |
| **Anomaly detection** | Payroll outliers, attendance fraud (impossible geo-jumps), duplicate/suspicious expenses. |
| **Smart scheduling** | Interview slot optimisation across panel calendars. |
| **Semantic search** | pgvector in Neon over employees, policies, documents, tickets. |

### 2.3 HR domain depth

| Area | Additions |
|---|---|
| **Payroll** | Multi-country engine, off-cycle runs, retro/arrears, full Indian statutory filing (Form 16, 24Q, PF ECR, ESI, PT, LWF), payroll approval workflow with maker-checker, bank advice file generation, payslip PDF with digital signature. |
| **Time & attendance** | Geofenced punch, selfie/face verification, biometric device integration, rule-based rostering, shift swap marketplace, overtime rules engine, regularisation workflow. |
| **Performance** | Cascading OKRs, 9-box talent grid, calibration sessions, continuous check-ins, 360° with anonymity guarantees, competency framework mapping. |
| **Compensation** | Merit cycle planning, budget pools, comp-ratio analysis, benchmarking, equity/ESOP tracking, total-rewards statement. |
| **Workforce planning** | Headcount budgeting vs actuals, scenario modelling, req-to-hire pipeline, span-of-control analysis. |
| **Learning** | SCORM/xAPI, learning paths, skill-gap analysis, certification expiry tracking, external LMS connectors. |
| **Benefits** | Open enrolment windows, dependant management, claims, insurer integration. |
| **Case management** | HR helpdesk with SLA, knowledge-base deflection, investigation workflows for grievances/incidents. |

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

| # | Task |
|---|---|
| 3.1.1 | Turborepo + pnpm workspace scaffold |
| 3.1.2 | `packages/ui` — design system ported from `WebSite/mobile/design-system` |
| 3.1.3 | `packages/api` — typed client generated from the Phase 2 OpenAPI spec, shared with web |
| 3.1.4 | `packages/auth` — identity SDK, biometric unlock, `expo-secure-store` token storage |
| 3.1.5 | `packages/offline` — SQLite/WatermelonDB sync engine with conflict resolution |
| 3.1.6 | `packages/push` — Expo Notifications + FCM/APNs |
| 3.1.7 | EAS Build + Submit pipelines; OTA updates via EAS Update |

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

## Immediate Next Actions (Phase 1 start)

1. Create the Neon project and the six schemas (via Neon MCP — **requires a Copilot CLI restart to
   load the MCP tools**).
2. Add Drizzle to HRMS and transcribe `src/types/` into `src/db/schema/`.
3. Delete the hardcoded Firebase key fallbacks and make missing env vars fail fast.
4. Stand up Vitest with the first tests on `payroll-engine.ts` and `rbac.ts`.
5. Introduce `IEmployeeRepository` and wire `employee-store.ts` to it behind `DATA_BACKEND`.

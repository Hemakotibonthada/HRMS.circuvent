# Circuvent Platform — Architecture (As-Is → To-Be)

**Owner:** Circuvent Technologies
**Scope:** All 6 applications in the Office Apps suite + mobile clients
**Status:** Phase 0 — Plan (approved sequence: Plan → Foundation → Features → Mobile)
**Last updated:** 2026-08-03

---

## 1. The Suite Today (As-Is)

Six applications, one shared Firebase project (`circuvent`), each with its own **named** Firestore
database. HRMS is the system of record for people data; everything else consumes it.

| App | Purpose | Pages / API | LOC | Data store | Deploy | Repo |
|---|---|---|---|---|---|---|
| **HRMS.circuvent** | HR platform — 92 dashboard modules | 96 / 12 | 52k | Firestore `hrms-circuvent` | Firebase Hosting `circuvent-hrms` | `Circuvent-Technologies/HRMS.circuvent` |
| **CV-365** | Productivity suite — docs, sheets, drive, CRM, wiki, tasks | 78 / 12 | 344k | Firestore `cv-365` | Firebase Hosting `cv-365` | `Circuvent-Technologies/CV-365` |
| **Mail.circuvent** | Enterprise email + IMAP/SMTP + mail-server admin | 74 / 58 | 113k | **Neon Postgres** + Firestore + RTDB | Firebase Hosting `circuvent-mail` | `Circuvent-Technologies/mail` |
| **ATS.circuvent** | Applicant tracking, careers, interviews | 37 / 2 | 12k | Firestore `ats-circuvent` | Firebase Hosting `circuvent-ats` | `Hemakotibonthada/ATS.circuvent` |
| **Office.Circuvent** | HR / DevOps portal (legacy) | 69 / 62 | — | PostgreSQL | Docker Compose | `Circuvent-Technologies/HRMS-Portal` |
| **WebSite** | circuvent.com marketing + customer portal + shop | 91 / 116 | — | **Neon Postgres** | **Vercel** | `Circuvent-Technologies/Company-Portal` |

### 1.1 How the apps are wired together

**URL resolution** — `src/lib/ecosystem.ts` is duplicated in each Next.js app and is the single
source of truth for sibling URLs. Production defaults to `circuvent.com` subdomains; every entry is
overridable with a `NEXT_PUBLIC_*_URL` env var for preview/local runs.

```
circuvent.com          → WebSite (landing + portal)
work.circuvent.com     → CV-365
hrms.circuvent.com     → HRMS.circuvent
ats.circuvent.com      → ATS.circuvent
mail.circuvent.com     → Mail.circuvent
paystub.circuvent.com  → Paystub.circuvent
```

**Identity fan-out** — `src/lib/cross-app-sync.ts` (HRMS) is the integration hub. Creating an
employee in HRMS performs a 4-step write:

```
1. Firebase Auth  createUserWithEmailAndPassword()  → canonical UID
2. Firestore hrms-circuvent  users/{uid} + employees/{uid}
3. Firestore cv-365          users/{uid}   (syncedFromHRMS: true)
4. Firestore (default)       users/{uid} + default mail labels
```

The **shared Firebase Auth UID is the join key** across all apps. `bulkSyncAllEmployees()` performs
the backfill; `checkUserExistsAcrossApps()` performs drift detection.

**Server-to-server** — `/api/sync/employee` and `/api/sync/bulk` are gated by a shared secret
(`CROSS_APP_SYNC_TOKEN`) sent as `X-Service-Token`, compared with `timingSafeEqual`. Fails closed
when unset.

**Multi-tenancy** — `src/lib/tenant.ts` scopes every Firestore query with
`where("organizationId", "==", currentOrgId)`. This is required (not merely defensive): Firestore
evaluates rules against the *query*, so a list read is only permitted if the query itself carries
the org filter. `users`, `organizations`, `subscriptions` are explicitly global.

**Authorization** — `src/lib/rbac.ts` defines 4 roles (`admin`, `hr`, `manager`, `employee`) over
~150 granular permissions, plus `MODULE_PERMISSION_MAP` gating all 92 modules. Unknown modules
fail closed to admin-only.

### 1.2 Assessment

**Genuinely strong:**
- Modern and consistent: Next.js 16.1.6, React 19.2.3, TypeScript strict, Tailwind 4, Zustand 5.
- Real domain depth — `payroll-engine.ts` implements full Indian payroll (PF, ESI, professional tax,
  TDS, §80C/§80D declarations, LOP, gratuity).
- Tenant isolation, RBAC, and Firebase Admin token verification (`server-auth.ts`) are all present
  and correctly implemented.
- ~110 exported domain types across `types/hrms.ts`, `types/models.ts`, `types/index.ts` — the
  relational schema is effectively already designed.

**Must fix (carried over from the April 2026 audit):**

| # | Issue | Location | Severity |
|---|---|---|---|
| 1 | Hardcoded Firebase API key fallback | `src/lib/firebase.ts:55`, `src/lib/cross-app-sync.ts:33` | High |
| 2 | Zero automated tests across HRMS / ATS / CV-365 | — | High |
| 3 | `firestore.indexes.json` empty → unindexed queries at scale | HRMS, ATS | High |
| 4 | No rate limiting on any API route | all Next.js apps | High |
| 5 | No Error Boundaries → one render error blanks the app | HRMS, ATS, CV-365 | Medium |
| 6 | No structured logging or error tracking | all except Mail (`pino`) | Medium |
| 7 | Accessibility never formally audited | all | Medium |

Already remediated since the audit: `.env.example` added, plaintext dev password moved to
`NEXT_PUBLIC_LOCAL_DEV_PASSWORD`, `server-auth.ts` added with real token verification, tenant
isolation added, Firestore rules corrected.

---

## 2. Target Architecture (To-Be)

### 2.1 Standing infrastructure decision

| Concern | Choice | Rationale |
|---|---|---|
| Database | **Neon** (serverless Postgres) | Already proven in Mail + WebSite. Branching per PR, scale-to-zero, HTTP driver works on Vercel Edge. |
| Web hosting | **Vercel** | Already proven in WebSite. Native Next.js 16, preview deploys, cron, edge middleware. |
| Long-running compute | **Oracle Cloud free-tier VMs** | Always-free ARM Ampere. For workloads Vercel cannot host: Postfix/Dovecot, queue workers, Redis, backups. |
| DNS / domain | **GoDaddy — circuvent.com** | Existing registrar; subdomain-per-app already established. |

**Explicit consequence:** Firebase is retired. Firestore → Neon Postgres. Firebase Auth → a shared
Circuvent identity service. Firebase Storage → Vercel Blob (or Cloudflare R2 for large/cheap).
Firebase Hosting → Vercel.

### 2.2 Target topology

```
                          ┌───────────────────────────┐
   GoDaddy DNS ──────────▶│  Vercel (edge + regions)  │
   circuvent.com          │  6 Next.js projects       │
   *.circuvent.com        └────────────┬──────────────┘
                                       │
                       ┌───────────────┼────────────────┐
                       ▼               ▼                ▼
              ┌─────────────┐  ┌──────────────┐  ┌─────────────┐
              │ Neon        │  │ Vercel Blob  │  │ Upstash     │
              │ Postgres    │  │ (documents,  │  │ Redis       │
              │ 1 project,  │  │  avatars,    │  │ (rate limit,│
              │ schema/app  │  │  payslips)   │  │  sessions)  │
              └─────────────┘  └──────────────┘  └─────────────┘
                       ▲
                       │  (private conn / pooled)
              ┌────────┴───────────────────────────────┐
              │ Oracle Cloud — always-free ARM VMs     │
              │  vm-mail   : Postfix + Dovecot + rspamd│
              │  vm-worker : BullMQ jobs, payroll runs,│
              │              report generation, cron   │
              │  vm-ops    : backups, monitoring       │
              └────────────────────────────────────────┘
```

### 2.3 Data architecture on Neon

**One Neon project (`circuvent`), one database (`circuvent`), one schema per app.** This keeps
cross-app joins possible (the single biggest win over the current 3-separate-Firestore-databases
design) while preserving ownership boundaries.

```sql
CREATE SCHEMA identity;   -- users, orgs, sessions, roles  (shared, owned by nobody)
CREATE SCHEMA hrms;       -- employees, payroll, leave, attendance, ...
CREATE SCHEMA ats;        -- jobs, candidates, applications, interviews
CREATE SCHEMA cv365;      -- docs, sheets, drive, tasks, crm
CREATE SCHEMA mail;       -- existing Mail.circuvent tables (already on Neon)
CREATE SCHEMA web;        -- existing WebSite tables (already on Neon)
```

**`identity` schema is the replacement for Firebase Auth + `cross-app-sync.ts`.** Instead of writing
the same user into three databases and hoping they stay consistent, every app reads one row:

```sql
identity.organizations (id, name, slug, plan, status, created_at, ...)
identity.users         (id, org_id → organizations, email UNIQUE, password_hash,
                        display_name, avatar_url, status, mfa_secret, created_at, ...)
identity.user_roles    (user_id, app, role)          -- per-app role, e.g. ('hrms','admin')
identity.sessions      (id, user_id, refresh_token_hash, ip, ua, expires_at, revoked_at)
identity.audit_log     (id, org_id, actor_id, app, action, entity, entity_id, meta, at)
```

**Tenancy** is enforced at two layers:
1. **Postgres Row-Level Security** — every tenant-scoped table gets
   `USING (org_id = current_setting('app.org_id')::uuid)`. The connection sets `app.org_id` from the
   verified session. This is strictly stronger than the current Firestore-query-filter approach
   because it cannot be bypassed by forgetting a `where` clause.
2. **Application layer** — Drizzle query helpers that require an org context, mirroring today's
   `tenant.ts` contract so the migration is mechanical.

**ORM: Drizzle.** Chosen over Prisma because it is edge-compatible (Prisma needs a driver adapter
and inflates the bundle), the generated SQL is inspectable, and `drizzle-kit` migrations are plain
`.sql` files that fit a Neon branch-per-PR workflow.

**Schema source:** the ~110 existing TypeScript interfaces in `src/types/` map almost 1:1 onto
tables. This is a transcription exercise, not a redesign.

### 2.4 Authentication

Replace Firebase Auth with a **shared Circuvent identity service** — the pattern Mail.circuvent
already proves (`jose` JWT + Postgres + httpOnly cookies).

- **Access token**: short-lived (15 min) JWT, signed with EdDSA, carrying
  `sub`, `org_id`, `roles`, `app`. Verifiable at the edge without a DB round-trip.
- **Refresh token**: opaque, 30-day, hashed in `identity.sessions`, rotated on use, revocable.
- **Cookie scope**: `Domain=.circuvent.com` so a single sign-in covers every subdomain — this
  delivers true SSO across the suite, which the current design only approximates.
- **MFA**: TOTP via `otpauth` (already a Mail dependency), backup codes, enforced per-org policy.
- **Passwords**: Argon2id.
- **SSO (enterprise)**: SAML 2.0 + OIDC connectors, and SCIM 2.0 for directory provisioning —
  both table stakes for selling HRMS to enterprises.

`ecosystem.ts` stays exactly as-is; only the hosts behind it change.

### 2.5 Oracle Cloud VM allocation

Always-free tier: 4 ARM Ampere OCPUs + 24 GB RAM, splittable across instances.

| VM | Spec | Runs |
|---|---|---|
| `vm-mail` | 2 OCPU / 12 GB | Postfix, Dovecot, rspamd, OpenDKIM — the mail transport Vercel cannot host. Mail.circuvent's Next.js frontend stays on Vercel and talks to this over IMAP/SMTP. |
| `vm-worker` | 1 OCPU / 6 GB | BullMQ workers: payroll runs, bulk imports, report/PDF generation, scheduled emails, cross-app reconciliation. Anything exceeding Vercel's function timeout. |
| `vm-ops` | 1 OCPU / 6 GB | `pg_dump` → object storage backups, Uptime Kuma, Grafana/Prometheus, log shipping. |

Vercel functions enqueue jobs; workers on `vm-worker` consume them. Neon is reachable from both.

### 2.6 DNS plan (GoDaddy → Vercel)

| Record | Type | Target | Purpose |
|---|---|---|---|
| `circuvent.com` | A / ALIAS | Vercel | WebSite |
| `www` | CNAME | Vercel | redirect → apex |
| `hrms` | CNAME | Vercel | HRMS |
| `work` | CNAME | Vercel | CV-365 |
| `ats` | CNAME | Vercel | ATS |
| `mail` | CNAME | Vercel | Mail web UI |
| `office` | CNAME | Vercel | Office portal |
| `api` | CNAME | Vercel | shared API surface |
| `mx1` | A | `vm-mail` public IP | mail transport |
| `@` | MX | `mx1.circuvent.com` (prio 10) | inbound mail |
| `@` | TXT | `v=spf1 mx ~all` | SPF |
| `default._domainkey` | TXT | DKIM public key | DKIM |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=...` | DMARC |

### 2.7 Storage migration

| From | To | Contents |
|---|---|---|
| Firebase Storage | **Vercel Blob** | avatars, employee documents, generated payslips, offer letters |
| Firestore blobs | Neon `bytea` / JSONB | small structured payloads only |

---

## 3. Migration Strategy — Strangler Pattern

A big-bang cutover of 500k+ LOC across six apps is not viable. Migrate app-by-app behind a
**repository interface**, so both back-ends can run simultaneously and traffic can be shifted with
an env flag.

```
┌──────────────────────────────────────────────┐
│  Zustand stores  (unchanged public API)      │
└───────────────────┬──────────────────────────┘
                    ▼
        ┌───────────────────────────┐
        │  IEmployeeRepository      │   ← new abstraction
        └─────┬──────────────┬──────┘
              ▼              ▼
   FirestoreEmployeeRepo   NeonEmployeeRepo
        (existing)              (new)
              └──── DATA_BACKEND=firestore|neon ────┘
```

**Order of migration** (lowest risk first):
1. **HRMS** — system of record, most valuable, best-typed. Sets the pattern.
2. **ATS** — smallest (12k LOC), shares HRMS's candidate/job model.
3. **CV-365** — largest; migrate module-by-module.
4. **Mail** — already partly on Neon; finish the Firestore/RTDB removal.
5. **Office.Circuvent** — already Postgres; re-point to Neon, then evaluate folding it into HRMS
   (it substantially duplicates HRMS functionality).
6. **WebSite** — already Neon + Vercel; only needs the identity-service swap.

**Dual-write window:** during cutover, writes go to both stores and a nightly reconciliation job on
`vm-worker` diffs them. Reads flip to Neon once the diff is clean for 7 consecutive days.

**Rollback:** flip `DATA_BACKEND` back to `firestore`. No redeploy required.

---

## 4. Mobile Architecture

**One Expo monorepo, six apps, one shared design system.** `WebSite/mobile` is already a mature
Expo React Native app (`circuvent-mobile`, with `eas.json`, `credentials/`, `design-system/`,
`modules/`, `plugins/`) — it becomes the template rather than a from-scratch build.

```
circuvent-mobile/            (Turborepo + pnpm)
├── apps/
│   ├── hrms/                Expo Router — employee self-service
│   ├── cv365/               docs, drive, tasks
│   ├── mail/                inbox, compose, push
│   ├── ats/                 recruiter + candidate
│   ├── website/             existing consumer/IoT app
│   └── office/              admin console
├── packages/
│   ├── ui/                  design system (ported from WebSite/mobile/design-system)
│   ├── api/                 typed client — shared with web
│   ├── auth/                identity SDK, biometric unlock, secure token store
│   ├── offline/             WatermelonDB / SQLite sync engine
│   └── push/                Expo Notifications + FCM/APNs
└── turbo.json
```

**Non-negotiables for mobile** (from `references/pro-rules.md`):
- 44×44 pt minimum touch targets, 8 pt spacing.
- Offline-first: HRMS field staff punch attendance without signal. Local SQLite is the source of
  truth; sync on reconnect with conflict resolution.
- Biometric unlock (Face ID / fingerprint) gating payroll and personal data.
- Safe-area-aware layout; no content under notch/home indicator.
- `prefers-reduced-motion` honoured; 150–300 ms transitions.
- Push: leave approvals, payslip released, interview scheduled, new mail.

**HRMS mobile scope (first release)** — deliberately not all 92 modules:
punch in/out with geofence + selfie, leave apply/approve, payslip view/download, attendance
history, team directory, approvals inbox, announcements, expense capture with receipt OCR,
holiday calendar, profile.

---

## 5. Target Stack Summary

| Layer | Today | Target |
|---|---|---|
| Framework | Next.js 16 / React 19 | unchanged |
| Language | TypeScript strict | unchanged |
| Styling | Tailwind 4 + shadcn/Base UI | unchanged |
| State | Zustand 5 | Zustand 5 + TanStack Query |
| Database | Firestore (3 named DBs) | **Neon Postgres**, schema-per-app, RLS |
| ORM | — | **Drizzle** + drizzle-kit |
| Auth | Firebase Auth | **Circuvent identity** (jose JWT + Argon2id + TOTP + SAML/OIDC/SCIM) |
| Files | Firebase Storage | **Vercel Blob** |
| Cache / rate limit | in-memory `Map` | **Upstash Redis** |
| Queue | — | **BullMQ** on Oracle `vm-worker` |
| Hosting | Firebase Hosting | **Vercel** |
| Mail transport | — | Postfix/Dovecot on Oracle `vm-mail` |
| Observability | `console.log` | **Sentry** + `pino` → Grafana |
| Tests | none | **Vitest** + Testing Library + **Playwright** |
| Mobile | none (except WebSite) | **Expo** monorepo, 6 apps |
| DNS | — | GoDaddy → Vercel + Oracle |

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Firestore → Postgres data loss | Critical | Dual-write + nightly reconciliation + 7-day clean-diff gate before read cutover |
| Firebase Auth password hashes are not exportable in usable form | High | Users set a new password on first login via emailed magic link; or run both auth systems during a 60-day window |
| CV-365 is 344k LOC | High | Migrate module-by-module; it is last in the order for a reason |
| Neon free tier limits (compute hours, 0.5 GB) | Medium | Start on Launch plan; branch-per-PR auto-suspends |
| Oracle free tier reclaims idle instances | Medium | Keep instances genuinely busy (workers + monitoring); take regular boot-volume backups |
| Vercel function timeout on payroll runs | Medium | Offload to BullMQ on `vm-worker`; Vercel only enqueues |
| Rewriting 92 modules stalls feature work | High | Repository abstraction means UI code is untouched during migration |

---

## 7. Decisions Log

| # | Decision | Rationale |
|---|---|---|
| D1 | Neon, one project, schema-per-app | Enables cross-app joins; keeps ownership boundaries |
| D2 | Drizzle over Prisma | Edge-compatible, smaller bundle, plain-SQL migrations |
| D3 | Custom identity service over Auth.js/Clerk | Mail already proves the pattern; SCIM/SAML needed for enterprise; no per-MAU cost |
| D4 | RLS in addition to app-layer scoping | Defence in depth; a forgotten `where` cannot leak tenants |
| D5 | Strangler migration, not big bang | 500k+ LOC across 6 apps; needs instant rollback |
| D6 | Expo monorepo, not 6 separate repos | One design system, one API client, one auth SDK |
| D7 | Keep `ecosystem.ts` unchanged | Cross-app URL contract is already correct |
| D8 | Retire Office.Circuvent into HRMS (later) | It duplicates HRMS; two HR systems is a liability |

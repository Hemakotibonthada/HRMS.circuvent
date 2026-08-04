# HRMS.circuvent

Multi-tenant HR platform — 92 modules covering the employee lifecycle from hire to exit, with an
Indian payroll engine (PF, ESI, professional tax, TDS, gratuity).

Part of the [Circuvent Office Suite](./docs/PLATFORM-ARCHITECTURE.md). HRMS is the system of record
for people data; ATS, CV-365, Mail and the Office portal consume it.

---

## Status

Mid-migration from Firebase to Neon Postgres on Vercel. See
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for what is done and what is next.

| | Current | Target |
|---|---|---|
| Database | Firestore `hrms-circuvent` | Neon Postgres, schema-per-app, row-level security |
| Auth | Firebase Auth | Circuvent identity service (JWT + Argon2id + TOTP) |
| Hosting | Firebase Hosting | Vercel |
| Files | Firebase Storage | Vercel Blob |

Both data backends run side by side behind `DATA_BACKEND`, so the cutover — and rollback — is an
environment variable rather than a deploy.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the values described below
npm run dev                    # http://localhost:3002
```

`npm run dev:localcreds` signs in against the fixed accounts in `src/lib/local-auth.ts` using
`NEXT_PUBLIC_LOCAL_DEV_PASSWORD`. Login fails closed when that variable is unset.

### Environment

Every variable is documented in [`.env.example`](./.env.example). The ones that matter most:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string. **Connect as `hrms_app`, not the Neon owner role** — RLS is bypassed by the table owner, so using the owner silently disables tenant isolation. |
| `DATA_BACKEND` | `firestore` \| `neon` \| `dual`. Selects which store serves reads and writes. |
| `AUTH_JWT_SECRET` | Signs the access token. Must be ≥ 32 characters; signing refuses to run otherwise. Generate with `openssl rand -hex 32`. |
| `AUTH_COOKIE_DOMAIN` | `.circuvent.com` in production so one sign-in covers every app subdomain. Leave unset locally. |
| `NEXT_PUBLIC_FIREBASE_*` | Required while `DATA_BACKEND` is `firestore` or `dual`. There are no hardcoded fallbacks; a missing value throws. |

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with Turbopack |
| `npm run build` | Production build |
| `npm run verify` | **The gate.** typecheck → lint (new code) → migrations + tenant isolation → tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Whole repo. Informational — see [Known issues](#known-issues). |
| `npm run lint:strict` | New code, zero warnings tolerated. Runs in CI. |
| `npm test` | Vitest |
| `npm run test:coverage` | Coverage, with thresholds on `payroll-engine` and `rbac` |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:verify` | Apply every migration to an in-memory Postgres and assert tenant isolation. **Needs no database.** |
| `npm run db:migrate:data` | Copy Firestore data into Neon. Supports `--dry-run` and `--verify`. |

---

## Architecture

```
src/
├── app/
│   ├── (auth)/          login, register, forgot-password
│   ├── (dashboard)/     92 modules
│   └── api/             route handlers
├── db/
│   ├── schema/          Drizzle — identity (shared) + hrms
│   ├── repositories/    the Firestore ↔ Neon seam
│   └── client.ts        Neon clients + withTenant()
├── lib/
│   ├── auth/            password, tokens, MFA, sessions
│   ├── payroll-engine.ts
│   ├── rbac.ts          4 roles, ~150 permissions, 92 module gates
│   ├── tenant.ts        Firestore-era org scoping
│   └── ecosystem.ts     cross-app URLs — same file in every Circuvent app
├── stores/              Zustand, backed by repositories
└── middleware.ts        edge auth gate
```

### Tenant isolation

Two layers, and the order matters.

**Postgres row-level security** is the real control. Every org-scoped table has a policy comparing
`org_id` to `current_setting('app.org_id')`, set by `withTenant()` with `SET LOCAL` inside a
transaction so a pooled connection cannot leak one tenant's context into the next request. A query
with no `WHERE` clause still cannot read another tenant.

**Application scoping** (`src/lib/tenant.ts`) is what the Firestore path relies on, where the filter
had to be remembered on every query. That is why the migration matters.

`npm run db:verify` proves the first layer against a real Postgres engine, including that an
unfiltered `SELECT` returns nothing from another organization.

### Authorization

`src/lib/rbac.ts` — four roles (`admin`, `hr`, `manager`, `employee`) over ~150 permissions, with
`MODULE_PERMISSION_MAP` gating all 92 modules. Unknown modules fail closed to admin-only.

Enforced in three places, deliberately redundant:
1. `middleware.ts` — coarse module gate at the edge, before page code runs
2. API route handlers — the real decision
3. Postgres RLS — the backstop

### Data access

Never call Firestore or Drizzle from a component. Go through a repository:

```ts
import { employeeRepository } from "@/db/repositories";

const repo = employeeRepository();          // client-side; honours DATA_BACKEND
const page = await repo.list({ search: "asha", pageSize: 25 });
```

Server-side code inside API routes constructs the Neon repository directly with the caller's tenant
context:

```ts
const ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
const repo = new NeonEmployeeRepository(ctx);
```

The organization always comes from the verified token, never from the request body or a query
parameter.

---

## Testing

```bash
npm test                  # everything
npm run db:verify         # migrations + tenant isolation, no database needed
```

Server-only modules (`src/lib/auth/**`, `src/middleware.test.ts`) declare
`// @vitest-environment node`. jose checks `instanceof Uint8Array`, and jsdom's `TextEncoder`
returns one from a different realm, so those tests fail under jsdom despite the code being correct.

Coverage thresholds are enforced on `payroll-engine.ts` and `rbac.ts` — the two modules where a
silent bug costs money or leaks another company's data.

---

## Known issues

`npm run lint` reports 5 errors and roughly 936 warnings that predate the pipeline. ESLint had
never actually run: `FlatCompat` threw `Converting circular structure to JSON` against
`eslint-plugin-react-hooks@7`, so the config was silently broken.

Fixing it exposed 44 real problems, of which **39 are now fixed** — every `Math.random()` and
`Date.now()` call made during render, every ref written or read during render, and every case of
state being corrected by an effect that could be derived instead. The `Math.random()` ones were
not only hydration-mismatch sources; they fabricated metrics and displayed them as measured
figures. See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full before/after tables.

The remaining 5 are all `preserve-manual-memoization`: the React Compiler declining to optimise a
component because it would memoise differently from the hand-written `useMemo`. That is a lost
optimisation rather than a correctness bug.

CI reports all of this but does not gate on it; `lint:strict` holds new code to zero.

---

## Deployment

`develop` → Vercel preview. `main` → production at `hrms.circuvent.com`.

CI (`.github/workflows/verify.yml`) runs typecheck, lint, migrations, tenant-isolation checks,
tests, build, and gitleaks secret scanning.

### Migrating data to Neon

```bash
npm run db:migrate:data -- --dry-run    # report only
npm run db:migrate:data                 # copy, then reconcile counts
npm run db:migrate:data -- --verify     # compare both stores
```

The script is idempotent — every write is an upsert on a natural key, so an interrupted run can be
repeated. Imported users arrive with `must_reset_password` set, because Firebase Auth password
hashes cannot be verified outside Firebase.

Set `DATA_BACKEND=dual` and let the nightly reconciliation run clean for seven days before moving
reads to `neon`.

---

## Documentation

- [`docs/PLATFORM-ARCHITECTURE.md`](./docs/PLATFORM-ARCHITECTURE.md) — all six apps, how they
  interconnect, and the target architecture
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — phased plan with status

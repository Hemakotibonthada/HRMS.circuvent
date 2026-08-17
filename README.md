# HRMS.circuvent

Multi-tenant HR platform — 92 modules covering the employee lifecycle from hire to exit, with an
Indian payroll engine (PF, ESI, professional tax, TDS, gratuity).

Part of the [Circuvent Office Suite](./docs/PLATFORM-ARCHITECTURE.md). HRMS is the system of record
for people data; ATS, CV-365, Mail and the Office portal consume it.

---

## Status

Runs on Neon Postgres, deployed to Vercel. See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for what is
done and what is next.

| | Stack |
|---|---|
| Database | Neon Postgres, schema-per-app, row-level security |
| Auth | Circuvent identity service (JWT + Argon2id + TOTP) |
| Hosting | Vercel |
| Files | Vercel Blob |

The migration off Firebase is **finished**. Firestore, Firebase Auth, Firebase Storage, the
`DATA_BACKEND` switch and the `firebase-admin` dependency have all been removed — Postgres is the
only backend, and there is no runtime path to anything else. `src/lib/collection-service.ts` (once
`firestore-service.ts`) is a plain HTTP client for this app's own API routes, which is why the name
changed: it kept suggesting a dependency that no longer exists.

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
| `AUTH_JWT_SECRET` | Signs the access token. Must be ≥ 32 characters; signing refuses to run otherwise. Generate with `openssl rand -hex 32`. |
| `ENCRYPTION_KEY` | Encrypts TOTP secrets, SSO client secrets, Aadhaar and PAN at rest. 32 bytes of base64 — `openssl rand -base64 32`. Encryption refuses to run without it rather than storing plaintext; reads are unaffected, so turning it on locks nobody out. |
| `AUTH_COOKIE_DOMAIN` | `.circuvent.com` in production so one sign-in covers every app subdomain. Leave unset locally. |

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
| `npm run db:verify:encryption` | Prove the encryption backfill and key rotation against a real Postgres engine. **Needs no database.** |
| `npm run db:verify:modules` | Prove expense claims and recruitment persist, stay tenant-isolated, and enforce their constraints. **Needs no database.** |
| `npm run db:verify:plans` | Prove the list-query indexes are actually chosen by the planner, with a counterfactual. **Needs no database.** |
| `npm run audit:data-paths` | Assert every dashboard page reads a collection something actually serves. |
| `npm run audit:fabricated` | Assert no invented metrics, fake statutory identifiers or placeholder people ship in the UI. |
| `npm run db:encrypt-fields` | Encrypt sensitive columns that are still plaintext, and re-wrap anything under a retired key. Idempotent; supports `--dry-run`. |
| `npm run db:seed:templates` | Install the eight document templates into every org that lacks them. Never overwrites. |

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
│   ├── repositories/    Postgres data access, one module per aggregate
│   └── client.ts        Neon clients + withTenant()
├── lib/
│   ├── auth/            password, tokens, MFA, sessions
│   ├── payroll-engine.ts
│   ├── rbac.ts          4 roles, ~150 permissions, 92 module gates
│   ├── tenant.ts        application-level org scoping (RLS is the real control)
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

**Application scoping** (`src/lib/tenant.ts`) adds a filter in application code. It is defence in
depth only: it has to be remembered on every query, which is exactly why RLS is the layer that
decides.

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

Never call Drizzle from a component. Go through a repository:

```ts
import { employeeRepository } from "@/db/repositories";

const repo = employeeRepository();          // client-side; talks to this app's API routes
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

---

## Documentation

- [`docs/PLATFORM-ARCHITECTURE.md`](./docs/PLATFORM-ARCHITECTURE.md) — all six apps, how they
  interconnect, and the target architecture
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — phased plan with status

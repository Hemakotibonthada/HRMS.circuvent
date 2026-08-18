# Deployment — circuvent.com

Concrete steps to put the suite on `circuvent.com`. Everything in §1 you have
to do yourself: I have no GoDaddy or Vercel credentials, and I would not accept
them if offered.

---

## 1. DNS records to add in GoDaddy

GoDaddy's nameservers stay authoritative. Vercel is pointed at by record, not
by nameserver delegation — delegating the whole zone to Vercel would move MX
and any other records you have, and email would stop.

**Go to:** GoDaddy → My Products → `circuvent.com` → DNS → Manage Zones.

### Apex and www

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | 600 |
| `CNAME` | `www` | `cname.vercel-dns.com` | 600 |

`76.76.21.21` is Vercel's apex anycast address. It is stable, but confirm it in
the Vercel dashboard when you add the domain — if Vercel shows something
different, Vercel is right and this document is stale.

### One subdomain per app

| Type | Name | Value | TTL | App |
|---|---|---|---|---|
| `CNAME` | `hrms` | `cname.vercel-dns.com` | 600 | HRMS.circuvent |
| `CNAME` | `ats` | `cname.vercel-dns.com` | 600 | ATS |
| `CNAME` | `cv` | `cname.vercel-dns.com` | 600 | CV-365 |
| `CNAME` | `mail` | `cname.vercel-dns.com` | 600 | Mail |
| `CNAME` | `office` | `cname.vercel-dns.com` | 600 | Office.Circuvent |
| `CNAME` | `api` | `cname.vercel-dns.com` | 600 | Public API (`/api/v1`) |

**Subdomains, not paths.** Each app is a separate Vercel project with its own
build, its own environment variables and its own rollback. A path-based split
means one bad deploy takes down all six.

**Do not add a `mail` MX record pointing at this.** `mail.circuvent.com` is the
web client. If you also want `@circuvent.com` email addresses, those MX records
go on the apex and are unrelated to anything here — putting a CNAME on a name
that also needs MX is one of the few DNS mistakes that is silently
irreversible until you notice bounced mail.

### Verification and certificates

Vercel will ask for a `TXT` record at `_vercel` to prove ownership. Add
whatever value it shows you; it is single-use and can be deleted afterwards.

Certificates are issued automatically once the records resolve. Give it up to
an hour before assuming something is wrong — GoDaddy's propagation is usually
minutes, but the certificate issuance waits on it.

### Records to leave alone

If the apex still has records pointing at a previous host, leave them until the
cutover is complete and verified. Deleting them first means the old site is down
while the new one is still issuing certificates.

---

## 2. Vercel projects

One project per app, each pointing at its own repository and branch.

| Project | Repository | Production branch | Domain |
|---|---|---|---|
| `hrms` | `Hemakotibonthada/HRMS.circuvent` | `main` | `hrms.circuvent.com` |
| `ats` | ATS repository | `main` | `ats.circuvent.com` |
| `cv365` | CV-365 repository | `main` | `cv.circuvent.com` |
| `mail` | Mail repository | `main` | `mail.circuvent.com` |
| `paystub` | Paystub.circuvent | `main` | `paystub.circuvent.com` |
| `website` | WebSite | `main` | `circuvent.com` + `www` |

`develop` deploys to a preview URL automatically. **Production is `main`**, so
nothing reaches a customer without a merge — which is the point of the branch
existing.

---

## 3. Environment variables

Set per project, per environment. Preview and production must have **different
database branches**: a preview deploy running migrations against production is
the single most expensive mistake available here.

### HRMS

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `DATABASE_URL` | Neon `main` branch, `hrms_app` role | Neon preview branch | **Never the owner role.** RLS `FORCE` covers the owner, but the owner can still `ALTER TABLE`. |
| `DATABASE_POOL_MAX` | `10` | `5` | Neon's connection limit is per project, not per deploy. |
| `JWT_SECRET` | generated, 32+ bytes | separate value | A shared secret means a preview token works in production. |
| `REFRESH_SECRET` | generated, separate from above | separate value | |
| `NEXT_PUBLIC_APP_URL` | `https://hrms.circuvent.com` | Vercel's preview URL | Used to build signing links; a wrong value sends candidates to a dead host. |
| `RESEND_API_KEY` | production key | **test key** | A preview deploy must not be able to email real candidates. |
| `ENCRYPTION_KEY` | 32 bytes, base64 | separate value | **Required.** Encrypts `mfa_secret`, SSO `client_secret`, `aadhaar_number` and `pan_number` at rest. Writes fail closed without it rather than silently storing plaintext. |
| `ENCRYPTION_KEY_PREVIOUS` | unset, except during a rotation | — | Comma-separated retired keys, kept decrypt-only so a rotation need not be simultaneous with rewriting every row. |

Generate secrets with `openssl rand -base64 32`. Do not reuse one across two
variables — if one leaks you want to rotate one thing, not four.

### Encrypting existing rows

`decryptField` reads plaintext transparently, so turning encryption on does not
lock out anyone already enrolled in MFA — but it also means nothing already in
the database gets encrypted. Rewrite it explicitly:

```bash
npm run db:encrypt-fields -- --dry-run   # report only
npm run db:encrypt-fields                # rewrite what needs it
```

Idempotent and safe to interrupt: a row already wrapped with the current key is
skipped.

### Rotating the key

```bash
# 1. Both keys present: new one current, old one decrypt-only.
ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> npm run db:encrypt-fields
# 2. When it reports nothing left to rewrite, drop ENCRYPTION_KEY_PREVIOUS.
```

The backfill decrypts before re-encrypting. Skipping that step wraps the old
ciphertext in a second envelope, which reads back as garbage — every enrolled
user is locked out, and it only surfaces at their next sign-in.
`npm run db:verify:encryption` exercises exactly this path against a real
Postgres, because it is not a mistake a unit test catches.

> **`bank_details` is not yet encrypted.** It is a `jsonb` column, so storing a
> ciphertext string in it needs a schema change rather than a backfill. Nothing
> writes to it today. Tracked in `docs/ROADMAP.md`.

### All apps

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_ECOSYSTEM_BASE` | `https://circuvent.com` |
| `NODE_ENV` | set by Vercel; do not override |

---

## 4. Neon

One project, one database per app, branches for environments.

```
circuvent (project)
├── main                    → production
│   ├── hrms
│   ├── ats
│   ├── cv365
│   └── mail
├── preview/*               → one branch per PR, auto-created
└── staging                 → long-lived, for the migration dry runs
```

**Roles.** Create `hrms_app` and grant it exactly what `apply_tenant_rls()`
grants. The migration user is separate and is not in any `DATABASE_URL`.

```sql
CREATE ROLE hrms_app WITH LOGIN PASSWORD '…';
GRANT USAGE ON SCHEMA identity, hrms TO hrms_app;
-- Table grants are issued by apply_tenant_rls() in migration 0003.
```

**Why the app role matters:** `scripts/verify-migrations.ts` runs its isolation
checks as `hrms_app` precisely because PGlite connects as a superuser and
superusers bypass RLS unconditionally. Running production as the owner would
make all 62 of those checks meaningless.

---

## 5. Cutover

**Completed.** HRMS serves all reads and writes from Neon, and Firebase has been
removed from the repository entirely — see `docs/ROADMAP.md` §1.6.7 for the
inventory of what was deleted.

The sequence that was followed, kept because it is the pattern the remaining
Office Suite apps should use for their own cutovers:

1. **Point the subdomains at Vercel** while the apex still serves the old host.
   Nothing customer-facing changes.
2. **Dry-run the data migration** against the staging branch — report what it
   would write without writing it.
3. **Run it for real against staging**, then verify by re-reading both sides and
   comparing.
4. **Dual-write** in production: writes to both stores, reads still from the
   old one. Run it for a week.
5. **Compare.** Any divergence is a bug in the repository layer, and this is
   the only phase where finding it is cheap.
6. **Switch reads.** The old store keeps receiving writes, so rollback is one
   environment variable.
7. **After a month with no rollback**, stop the dual writes.
8. **Move the apex.** This is the irreversible-feeling step, and it is
   deliberately last.

Do not compress steps 4–7. The dual-write window is the only opportunity to
discover a divergence while both systems still hold the truth.

---

## 6. Oracle free tier

The Oracle VMs are for what Vercel is bad at: long-running work with no request
attached.

| Workload | Why not Vercel |
|---|---|
| Payroll runs | Minutes of CPU; Vercel functions time out. |
| SLA escalation sweep (`/api/helpdesk/escalations`) | Needs a scheduler, and reads every open ticket. |
| Retention runs (`/api/governance`) | Same, and must not be triggered by a web request. |
| Nightly Neon → object-storage backup | Neon's own backups are good; a second copy you control is better. |

Two `VM.Standard.A1.Flex` instances (4 OCPU / 24 GB total on the free tier) in
the same region as the Neon project. Cross-region adds latency to every query,
and payroll makes a great many of them.

---

## 7. What is not done

Being explicit so nothing is assumed:

- **No Neon project exists yet.** Everything above is the plan, not the state.
  The Neon MCP tools are installed but were not loaded — that needs a CLI
  restart.
- **No Vercel project exists yet.**
- **No DNS records have been changed.** I have not touched GoDaddy and cannot.
- **`main` has not been created** for HRMS. All work is on `develop`.
- **The migration script has never been run against real data**, only against
  PGlite in CI.

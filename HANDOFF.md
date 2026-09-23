# HRMS on Platform VM — handoff

**Updated:** 2026-09-23 23:38 IST (Asia/Calcutta)

## Shipped
- Next.js HRMS from `HRMS.circuvent` built and running as `circuvent-hrms` on **port 3013**.
- Joins Docker network `platform_platform-net`; `DATABASE_URL` → VM Postgres **`circuvent_hrms`** as role **`circuvent_hrms_app`** (not Neon).
- Schema grants fixed: `USAGE` on `hrms` + `identity`, R/W on tables/sequences (role has `rolbypassrls=false`).
- SSO wired: public OIDC client `hrms` → `https://myaccount.circuvent.com` (PKCE; no `SSO_CLIENT_SECRET`).
- Coolify Traefik dynamic file prepared: `/data/coolify/proxy/dynamic/hrms.circuvent.yaml` → `host.docker.internal:3013`.
- **Public DNS for `hrms.*` / `ats.*` etc. was NOT changed.** Neon/Vercel left live.

## Smoke (2026-09-23)
| Check | Result |
|-------|--------|
| Container healthy | `circuvent-hrms` healthy on `:3013` |
| `GET /api/health` | 200 `{"status":"ok","service":"circuvent-hrms",...}` |
| DB from container | `circuvent_hrms_app` @ `circuvent_hrms`, 137 `hrms` tables, `bypass=false` |
| Employees without GUC | 0 rows (RLS expected); platform role still sees sample rows |
| `GET /api/auth/sso/start` | 307 → `https://myaccount.circuvent.com/authorize?client_id=hrms&redirect_uri=https://hrms.circuvent.com/...` |
| Platform `:3012` / Auth `:3011` | still 200 / healthy |

## Env names in `.env.production` (values not listed)
`PORT`, `NODE_ENV`, `HOSTNAME`, `DATABASE_DRIVER`, `DATABASE_URL`,
`ENCRYPTION_KEY`, `AUTH_JWT_SECRET`, `ONBOARDING_TOKEN_SECRET`, `CROSS_APP_SYNC_TOKEN`, `CRON_SECRET`,
`AUTH_ISSUER`, `SSO_CLIENT_ID`, `SSO_REDIRECT_URI`,
`APP_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_HRMS_URL`, `NEXT_PUBLIC_ATS_URL`,
`NEXT_PUBLIC_MAIL_URL`, `NEXT_PUBLIC_WORK_URL`, `NEXT_PUBLIC_LANDING_URL`,
`SMTP_*`, `MAIL_*`

See `.env.production.example`. Secrets sourced from Mac `HRMS.circuvent/.env.local` + VM `DATABASE_URL` already pointing at Postgres. Never commit `.env.production`.

## URLs
| Purpose | URL |
|---------|-----|
| Pre-DNS smoke (VM) | `http://140.245.203.193:3013/api/health` |
| Intended public (after cutover) | `https://hrms.circuvent.com` |
| Auth issuer | `https://myaccount.circuvent.com` |
| SSO start | `/api/auth/sso/start` |

## How to cut DNS later (explicit user approval required)
1. Confirm smoke table still green and Auth issuer JWKS reachable from the HRMS container.
2. GoDaddy: set `hrms` A (or CNAME) to **140.245.203.193** (Platform VM). Do **not** touch Mail MX (`140.245.229.117`) or IoT.
3. Traefik file already in place; wait for Let’s Encrypt on `hrms.circuvent.com`.
4. Full browser SSO: visit `https://hrms.circuvent.com` → Sign in with Circuvent → callback `https://hrms.circuvent.com/api/auth/callback` (already registered on oauth client `hrms`).
5. Keep Neon/Vercel until post-cutover verification; then decommission separately.

## Paths on VM
- App + compose: `/opt/circuvent/hrms/`
- Secrets / DB password file: `/opt/circuvent/secrets/pg-circuvent_hrms_app`
- Traefik: `/data/coolify/proxy/dynamic/hrms.circuvent.yaml`

## Rebuild
```bash
cd /opt/circuvent/hrms
# rsync from Mac HRMS.circuvent (exclude /mobile /android node_modules .next .env*)
docker compose build && docker compose up -d
```
**Note:** `.dockerignore` must use `/mobile` and `/android` (leading slash). A bare `mobile` pattern also excludes `src/lib/mobile` and breaks the build.

## ATS / Assets / Devices (next)
- **ATS.circuvent**, **Assets.circuvent**, **Devices.circuvent** exist on the Mac Office Suit.
- Same Neon `hrms` dump restored into `circuvent_hrms` — family apps likely share this DB.
- Prioritize after HRMS DNS cutover (or parallel scaffold): clone pattern from `/opt/circuvent/hrms` (compose on platform-net, ports 3014+/Traefik YAML only, reuse `circuvent_hrms_app` or dedicated roles, SSO via Auth).
- ATS historically delegated SSO through HRMS cookie (see Auth `SSO-ROLLOUT.md`); confirm current ATS OIDC vs cookie delegation before wiring.

## Role portal hosts (2026-09-23)
Traefik `hrms.circuvent.yaml` also routes:
`hr.circuvent.com`, `employee.circuvent.com`, `intern.circuvent.com`, `manager.circuvent.com`
→ same `circuvent-hrms:3013` with `passHostHeader` (portal SSO redirect_uri per Host).
Auth oauth client `hrms` already had these redirect URIs.

## Portal DNS cutover (done 2026-09-23 23:38 IST)
User-approved. Only `hr`, `employee`, `intern`, `manager`, `career` touched (career details in `/opt/circuvent/career/HANDOFF.md`).

| Host | Before | After |
|------|--------|-------|
| hr / employee / intern / manager | CNAME → `031da0577e7e205d.vercel-dns-017.com` TTL 600 | A → **140.245.203.193** TTL 600 |
| career | CNAME → `5445cc6f15d0b777.vercel-dns-017.com` TTL 3600 | A → **140.245.203.193** TTL 600 |

- Snapshot Mac: `/tmp/dns-cutover-portals-20260923-233507/`
- LE issued after one `docker restart coolify-proxy`
- Smoke: each portal `/api/health` 200; SSO start 307 → myaccount with per-host `redirect_uri`; trusted HTTPS OK
- Untouched: MX, mqtt, mail, apex, `hrms` (already Platform)
- Pending: browser SSO soak; Neon/Vercel decommission later
- Rollback: restore CNAMEs from snapshot `{host}-CNAME-before.json`

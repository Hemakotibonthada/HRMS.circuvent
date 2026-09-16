# HRMS role portals

These are virtual hosts of the same HRMS application, not copies of the database.

## Navigation

The central HRMS retains the category sidebar. Role subdomains use a focused product header, following CV-365's CRM portal pattern: Home, permission-filtered section links, and a second row for the active section's features. The header includes search, notifications, theme, profile, workspace switching and sign-out. Both navigation rows scroll on narrow screens. The home page groups tools into filterable sections rather than showing one long module list. No workforce statistics are fabricated for these cards; displayed counts are the number of available tools.

The shared `hrms-navigation.ts` registry ensures each permitted tool appears once and keeps nested detail pages in their parent section. Adding navigation does not grant access; middleware and API authorization remain in force.

- `employee.circuvent.com`: personal attendance, leave, payslips, documents, benefits, development and support.
- `intern.circuvent.com`: time, leave, learning, goals, documents and team tools. Requires a tenant-scoped employee record with employment type `intern`; HR/admin/owner can preview.
- `hr.circuvent.com`: HR operations, recruitment, onboarding, intern management, payroll and reporting. HR/admin/owner only.
- `manager.circuvent.com`: team requests, attendance, performance and reporting. Manager/HR/admin/owner only.
- `hrms.circuvent.com`: existing full HRMS and administration. Existing role restrictions remain.

Hosts are lowercase because DNS names are case-insensitive. The existing `/interns` page remains HR's intern-management screen; it is not exposed to an intern just because the host is `intern`.

## Security and data

The subdomain chooses navigation and a home page. It never selects the organization, grants a role or changes account records. The organization comes from the signed session; existing API authorization and tenant/RLS checks remain authoritative. Portal module allowlists additionally limit page navigation, command search and direct page requests. API permissions are those of the actual account, not an impersonated employee: an HR administrator previewing the employee portal remains an HR administrator. Intern classification is checked on the server before rendering its dashboard shell.

Unknown hosts retain the existing HRMS experience for deployment previews; they cannot become role portals through a query parameter or forwarded header. Known virtual hosts are selected from Host, with an exact-name allowlist. Session and PKCE cookies remain host-only. A new host can require a separate local session; Continue with SSO reuses the identity-provider sign-in without sharing `cv_access` across apps.

## Activation checklist (not performed by the code change)

1. Attach the four production hostnames above to the **existing HRMS Vercel project**. Do not attach them to My Space, Auth or Attendance.
2. In the authoritative DNS zone, configure each hostname using the exact DNS target returned by Vercel for that project. Wait for domain verification and TLS readiness. Do not replace existing DNS records blindly.
3. Register the exact callback and post-logout addresses for the existing `hrms` OAuth client. The additive registration script in `Auth.circuvent` now includes the four portals. From that project run `node scripts/register-suite-clients.mjs --client=hrms` with the correct identity database configured. It preserves existing URIs; it does not create roles or assign employees. This command changes identity configuration and is not part of ordinary local startup.
4. Deploy the HRMS changes. Keep its existing database, JWT secret, OAuth client ID/secret and canonical `SSO_REDIRECT_URI`. The four allowlisted portal hosts override only the callback URI, using `/api/auth/callback` on their own origin so PKCE cookies stay on the same host.
5. Verify each host with separate employee, intern, manager and HR test accounts. Check direct forbidden URLs, sign-in, logout, organization scoping and a normal attendance/leave flow. Do not use live employee data to test mutations.

## Local testing

Run HRMS on port 3002. Use `http://employee.localhost:3002`, `http://intern.localhost:3002`, `http://hr.localhost:3002` and `http://manager.localhost:3002`. Browsers generally resolve `.localhost` to loopback; if the resolver does not, add explicit development host mappings with your administrator. No hosts file is changed by this implementation.

For an HTTP routing check without changing the resolver:

    curl --resolve employee.localhost:3002:127.0.0.1 -I http://employee.localhost:3002/

Expected: redirect to `/workspace`, then `/login` without a session. Password sign-in uses the existing account. Local SSO additionally requires the exact `.localhost:3002/api/auth/callback` URIs in the identity client (included in the registration script). Production never enables the `.localhost` portal aliases.

Run the regression suite:

    npx vitest run src/lib/hrms-portals.test.ts src/lib/hrms-portal-sso.test.ts src/lib/hrms-intern-gate.test.tsx src/middleware.test.ts src/lib/rbac.test.ts

No payroll, billing, employment-role or database migrations are needed for these portals.

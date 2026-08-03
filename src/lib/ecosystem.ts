// ═══════════════════════════════════════════════════════════════
// ECOSYSTEM URLS — single source of truth for cross-app links
// ═══════════════════════════════════════════════════════════════
// Every Circuvent app resolves its siblings' URLs from here so the
// ecosystem stays wired consistently across deployments.
//
// Production defaults to the canonical circuvent.com subdomains
// (matching the landing page "Explore" links). Override any of them
// per-environment with NEXT_PUBLIC_*_URL vars — e.g. Vercel preview
// deployments, custom domains, or running several apps locally.

const isProd = process.env.NODE_ENV === "production";

function resolve(envValue: string | undefined, prodUrl: string, devPort: number): string {
  const raw = envValue && envValue.trim() ? envValue : isProd ? prodUrl : `http://localhost:${devPort}`;
  return raw.replace(/\/+$/, "");
}

export const ECOSYSTEM = {
  /** Marketing site + company portal */
  landing: resolve(process.env.NEXT_PUBLIC_LANDING_URL, "https://circuvent.com", 3000),
  /** CV-365 — unified productivity suite */
  work: resolve(process.env.NEXT_PUBLIC_WORK_URL, "https://work.circuvent.com", 3000),
  /** HRMS.circuvent — HR management system */
  hrms: resolve(process.env.NEXT_PUBLIC_HRMS_URL, "https://hrms.circuvent.com", 3002),
  /** ATS.circuvent — applicant tracking */
  ats: resolve(process.env.NEXT_PUBLIC_ATS_URL, "https://ats.circuvent.com", 3003),
  /** Mail.circuvent — email platform */
  mail: resolve(process.env.NEXT_PUBLIC_MAIL_URL, "https://mail.circuvent.com", 3004),
  /** Office.Circuvent — HR/DevOps portal API (Express backend) */
  office: resolve(process.env.NEXT_PUBLIC_OFFICE_URL, "https://office.circuvent.com", 3001),
} as const;

export type EcosystemAppId = keyof typeof ECOSYSTEM;

/** Metadata for building cross-app navigation (app switcher). */
export interface EcosystemApp {
  id: EcosystemAppId;
  name: string;
  description: string;
  url: string;
}

export const ECOSYSTEM_APPS: EcosystemApp[] = [
  { id: "work", name: "CV-365", description: "Workspace & productivity", url: ECOSYSTEM.work },
  { id: "hrms", name: "HRMS", description: "HR management", url: ECOSYSTEM.hrms },
  { id: "ats", name: "ATS", description: "Applicant tracking", url: ECOSYSTEM.ats },
  { id: "mail", name: "Mail", description: "Email platform", url: ECOSYSTEM.mail },
  { id: "office", name: "Office", description: "HR & DevOps portal", url: ECOSYSTEM.office },
  { id: "landing", name: "Circuvent.com", description: "Company website", url: ECOSYSTEM.landing },
];

// SEO and link-preview configuration for hrms.circuvent.com.
//
// One module owns the canonical origin, the copy that appears in search results
// and chat previews, and the structured data. Splitting these across layout
// files is how a suite ends up with four different descriptions of itself and a
// canonical URL pointing at localhost.

import type { Metadata } from "next";
import type { OgCardOptions } from "@/lib/og";

/** Canonical public origin. Override per deployment with NEXT_PUBLIC_HRMS_URL. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_HRMS_URL || "https://hrms.circuvent.com"
).replace(/\/+$/, "");

/**
 * Only the real production deployment may be indexed.
 *
 * Vercel previews serve the same pages on a public hostname. Left crawlable
 * they compete with production for the same queries and expose unreleased work,
 * and removing a URL from an index is far harder than keeping it out.
 */
export const IS_PUBLIC_SITE =
  process.env.NEXT_PUBLIC_DEPLOY_ENV === "production" ||
  (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";

export const siteConfig = {
  name: "Circuvent HRMS",
  shortName: "HRMS",
  company: "Circuvent Technologies",
  url: SITE_URL,
  tagline: "Hire to retire, in one system",
  description:
    "Multi-tenant HR platform covering the full employee lifecycle — onboarding, attendance, leave, performance and exit — with an Indian payroll engine that handles PF, ESI, professional tax, TDS and gratuity.",
  themeColor: "#7c3aed",
  // Empty by default: `@circuvent_tech` was advertised in `twitter:site`,
  // `twitter:creator` and `sameAs`, but the account does not exist -- x.com
  // returns 404. A card attributed to a missing handle is a dead reference,
  // and in `sameAs` it actively weakens the entity resolution this brand can
  // least afford. Set NEXT_PUBLIC_TWITTER_HANDLE once a real account exists.
  twitterHandle: process.env.NEXT_PUBLIC_TWITTER_HANDLE || "",
  locale: "en_IN",
} as const;

/** Artwork shown when a link to this app is pasted into a chat or timeline. */
export const OG_CARD: OgCardOptions = {
  product: "HRMS",
  domain: "hrms.circuvent.com",
  headline: "Hire To Retire,",
  headlineAccent: "In One System.",
  tagline: "Payroll · Attendance · Leave · Performance · Compliance",
  accent: "#a78bfa",
  accentAlt: "#7c3aed",
  stats: [
    { value: "92", label: "HR Modules" },
    { value: "PF+ESI+TDS", label: "Indian Payroll" },
    { value: "Multi", label: "Tenant" },
    { value: "RLS", label: "Data Isolation" },
  ],
};

const KEYWORDS = [
  "Circuvent HRMS",
  "HR management system",
  "HRMS India",
  "payroll software",
  "Indian payroll PF ESI TDS",
  "attendance management",
  "leave management",
  "performance management",
  "employee onboarding",
  "multi-tenant HR platform",
  "Circuvent Technologies",
];

/**
 * Base metadata for the whole app. Individual routes override `title` and
 * `description` and inherit everything else, so a new page is discoverable and
 * shareable without repeating any of this.
 */
export const baseMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: KEYWORDS,
  authors: [{ name: siteConfig.company, url: "https://circuvent.com" }],
  creator: siteConfig.company,
  publisher: siteConfig.company,
  category: "business",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: SITE_URL,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    // Spread away entirely when unset: an empty attribution attribute is worse
    // than no attribution, and the large-image card renders fine without it.
    ...(siteConfig.twitterHandle
      ? { site: siteConfig.twitterHandle, creator: siteConfig.twitterHandle }
      : {}),
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  // Mirrors robots.ts on purpose. robots.txt only stops the crawl; a page linked
  // from anywhere else can still be indexed on the strength of that link, and a
  // meta tag saying "index" is the wrong thing for a crawler to find if it does.
  robots: IS_PUBLIC_SITE
    ? {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
      }
    : { index: false, follow: false, nocache: true },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: siteConfig.shortName,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, address: false, email: false },
  other: {
    // Next emits the standardised `mobile-web-app-capable`, which only Safari
    // 17.4+ understands. Older iOS still checks the Apple-prefixed name.
    "apple-mobile-web-app-capable": "yes",
  },
};

/**
 * Per-page metadata.
 *
 * `canonical` matters more here than the title: several routes are reachable
 * with query strings (?dept=, ?location=) and without an explicit canonical
 * each variant is a separate URL competing with itself in the index.
 */
export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}): Metadata {
  const { title, description, path, index = true } = input;
  const url = `${SITE_URL}${path}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: `${title} | ${siteConfig.name}`,
      description,
      url,
      locale: siteConfig.locale,
    },
    twitter: {
      card: "summary_large_image",
      ...(siteConfig.twitterHandle ? { site: siteConfig.twitterHandle } : {}),
      title: `${title} | ${siteConfig.name}`,
      description,
    },
    robots:
      index && IS_PUBLIC_SITE
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

// ─────────────────────────────────────────────────────── structured data ──

/** Serialises JSON-LD for a <script> tag without letting `</script>` escape it. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Stable identifier for the company as an entity, shared by every app in the
 * suite. All six hostnames point at this one `@id` so they read as one company
 * with several products, rather than six similarly-named companies.
 */
export const ORGANIZATION_ID = "https://circuvent.com/#organization";

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: siteConfig.company,
    // "Circuvent" is a coined word one character from "circumvent", so search
    // engines read the query as a typo and correct it. Naming the short forms
    // is how the token gets attached to this entity rather than to the
    // dictionary word.
    alternateName: ["Circuvent", "Circuvent Tech", "circuvent.com"],
    url: "https://circuvent.com",
    logo: "https://circuvent.com/logo-mark.png",
    // Only profiles that actually resolve. `sameAs` is the main mechanism
    // search engines have for tying a site to an entity they already know, and
    // it is worth nothing when the URLs 404 -- which the previously advertised
    // `/company/circuvent-technologies` and `x.com/circuvent_tech` both do.
    sameAs: [
      "https://www.linkedin.com/company/circuvent",
      "https://github.com/Hemakotibonthada",
    ],
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Human Resource Management",
    operatingSystem: "Web, Android",
    url: SITE_URL,
    description: siteConfig.description,
    publisher: { "@id": ORGANIZATION_ID },
    featureList: [
      "Employee records and org chart",
      "Attendance and shift management",
      "Leave policies and approvals",
      "Indian payroll — PF, ESI, professional tax, TDS, gratuity",
      "Performance reviews and goals",
      "Recruitment and onboarding",
      "Exit and full-and-final settlement",
    ],
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: siteConfig.name,
    url: SITE_URL,
    inLanguage: "en",
    // References the shared Organization rather than restating it, so this
    // hostname corroborates the same entity as the rest of the suite instead
    // of describing a separate publisher that happens to share a name.
    publisher: { "@id": ORGANIZATION_ID },
  };
}

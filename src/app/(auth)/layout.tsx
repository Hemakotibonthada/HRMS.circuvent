import type { Metadata } from "next";
import { headers } from "next/headers";
import { HRMS_PORTALS, PORTAL_HEADER, type HrmsPortal } from "@/lib/hrms-portals";
import { metadataForPortal } from "@/lib/seo";

// Sign-in, registration and password reset. Portal-aware OG/canonical so a
// pasted employee/intern/hr/manager login link previews with the correct host
// and title. Explicit images keep the root opengraph-image route attached when
// nested metadata would otherwise drop the file-convention merge.

export async function generateMetadata(): Promise<Metadata> {
  const requested = (await headers()).get(PORTAL_HEADER) ?? "hrms";
  const portal: HrmsPortal = Object.hasOwn(HRMS_PORTALS, requested)
    ? (requested as HrmsPortal)
    : "hrms";
  const def = HRMS_PORTALS[portal];
  const base = metadataForPortal(portal);
  const title = `Sign in | ${def.name}`;
  const url = `https://${def.host}/login`;
  return {
    ...base,
    title: "Sign in",
    description: def.description,
    alternates: { canonical: "/login" },
    openGraph: {
      type: "website",
      siteName: def.name,
      title,
      description: def.description,
      url,
      locale: "en_IN",
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: def.description,
      images: ["/twitter-image"],
    },
    robots: { index: false, follow: false },
  };
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

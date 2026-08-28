import type { MetadataRoute } from "next";
import { SITE_URL, IS_PUBLIC_SITE } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Preview deployments serve the same pages on a public hostname. Left
  // crawlable they compete with production for the same queries and expose
  // unreleased work, and de-indexing afterwards is far harder than never being
  // indexed in the first place.
  if (!IS_PUBLIC_SITE) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/careers"],
        // The dashboard is the whole product and every route under it is gated.
        // Crawling them yields a set of duplicate sign-in redirects, which is
        // both wasted crawl budget and a pile of soft-404s on the hostname that
        // is supposed to rank for "Circuvent HRMS".
        disallow: [
          "/api/",
          "/dashboard",
          "/employees",
          "/attendance",
          "/leave",
          "/payroll",
          "/performance",
          "/recruitment",
          "/reports",
          "/settings",
          "/admin",
          "/profile",
          "/refer/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

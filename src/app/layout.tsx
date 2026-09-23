import type { Metadata, Viewport } from "next";
import { Open_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { headers } from "next/headers";
import { HrmsPortalProvider } from "@/components/hrms-portal-provider";
import { HRMS_PORTALS, PORTAL_HEADER, type HrmsPortal } from "@/lib/hrms-portals";
import {
  baseMetadata,
  jsonLd,
  metadataForPortal,
  organizationJsonLd,
  siteConfig,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/seo";
import "./globals.css";

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export async function generateMetadata(): Promise<Metadata> {
  const requested = (await headers()).get(PORTAL_HEADER) ?? "hrms";
  if (requested === "hrms" || !Object.hasOwn(HRMS_PORTALS, requested)) return baseMetadata;
  return metadataForPortal(requested as HrmsPortal);
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: siteConfig.themeColor,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requested = (await headers()).get(PORTAL_HEADER) ?? "hrms";
  const portal: HrmsPortal = Object.hasOwn(HRMS_PORTALS, requested) ? requested as HrmsPortal : "hrms";
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* Structured data. `manifest`, icons, theme colour and every OG/Twitter
            tag come from the metadata and viewport exports above; only JSON-LD
            has no Metadata API equivalent and has to be emitted by hand. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(organizationJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(websiteJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(softwareApplicationJsonLd()) }}
        />
      </head>
      <body className={`${openSans.variable} font-sans antialiased`}>
        <Providers><HrmsPortalProvider portal={portal}>{children}</HrmsPortalProvider></Providers>
      </body>
    </html>
  );
}

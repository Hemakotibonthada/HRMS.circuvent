/* eslint-disable @next/next/no-img-element */
// Shared renderer for the 1200x630 card that WhatsApp, Slack, LinkedIn, X,
// iMessage and Google all pull when someone pastes a link to this app.
//
// It is deliberately self-contained: no network fetch, no filesystem read, no
// dependency on knowing the deployment's own URL. Every one of those is a way
// for a preview to fail *silently* -- the page keeps working, the link just
// renders as a bare grey URL, and nobody notices until it is already in a
// customer's inbox.
//
// The composition is deliberately restrained: mark and wordmark at the top, one
// headline and a short paragraph in the middle, the hostname at the foot. A
// preview is usually read a few hundred pixels wide in a chat list, and what
// survives that is contrast and whitespace. An earlier version carried a grid
// and a row of statistics; at thumbnail size those become texture and
// unreadable specks, and they crowd the one line that actually has to land.
//
// Layout matches the rest of the Circuvent suite, so a link to Mail, HRMS, ATS,
// CV-365, Paystub or the marketing site is recognisably the same company.

import { ImageResponse } from "next/og";
import { LOGO_MARK_DATA_URI } from "@/lib/brand-logo";
import { OG_FONTS } from "@/lib/og-fonts";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export interface OgCardOptions {
  /** Word shown beside the mark, e.g. "Mail". Omit for the company itself. */
  product?: string;
  /** Host shown at the foot, e.g. "mail.circuvent.com". */
  domain: string;
  /** The one line that has to land. Kept to a single sentence. */
  headline: string;
  /** Two or three lines of supporting detail underneath. */
  description: string;
  /**
   * Deep tone the background washes from, top-left to centre. Defaults to the
   * Circuvent navy; apps pass their own so the suite is varied but coherent.
   */
  accent?: string;
}

/** The navy the marketing site uses. */
const DEFAULT_ACCENT = "#0a1b44";

export function ogCard(options: OgCardOptions) {
  const { product, domain, headline, description, accent = DEFAULT_ACCENT } = options;

  return (
    <div
      style={{
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        backgroundColor: "#05070c",
        // A single diagonal wash. satori handles linear-gradient reliably; its
        // radial support is narrower, and a gradient it cannot parse degrades
        // to flat black with no error anywhere.
        backgroundImage: `linear-gradient(135deg, ${accent} 0%, #05070c 62%)`,
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* masthead */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <img src={LOGO_MARK_DATA_URI} width={84} height={84} alt="" style={{ marginRight: 22 }} />
        <span
          style={{
            display: "flex",
            fontSize: 44,
            fontWeight: 700,
            color: "#f7f8fa",
            letterSpacing: -1,
          }}
        >
          {product ?? "Circuvent"}
        </span>
      </div>

      {/* the message */}
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 920 }}>
        <span
          style={{
            display: "flex",
            fontSize: 54,
            fontWeight: 700,
            color: "#f7f8fa",
            lineHeight: 1.15,
            letterSpacing: -0.5,
          }}
        >
          {headline}
        </span>
        <span
          style={{
            display: "flex",
            fontSize: 26,
            color: "#a7b0c4",
            lineHeight: 1.5,
            marginTop: 20,
          }}
        >
          {description}
        </span>
      </div>

      {/* foot */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ display: "flex", fontSize: 22, color: "#7c88a3" }}>{domain}</span>
      </div>
    </div>
  );
}

/** Builds the PNG response for an `opengraph-image` / `twitter-image` route. */
export function ogImageResponse(options: OgCardOptions): ImageResponse {
  return new ImageResponse(ogCard(options), { ...OG_SIZE, fonts: OG_FONTS });
}
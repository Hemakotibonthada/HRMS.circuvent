/* eslint-disable @next/next/no-img-element */
// Shared renderer for the 1200x630 card that WhatsApp, Slack, LinkedIn, X,
// iMessage and Google all pull when someone pastes a link to this app.
//
// It is deliberately self-contained: no network fetch, no filesystem read, no
// dependency on knowing the deployment's own URL. Every one of those is a way
// for a preview to fail *silently* — the page keeps working, the link just
// renders as a bare grey URL, and nobody notices until it is already in a
// customer's inbox.
//
// Layout matches the rest of the Circuvent suite so a link to Mail, HRMS, ATS,
// CV-365 or the marketing site is recognisably the same company.

import { ImageResponse } from "next/og";
import { LOGO_MARK_DATA_URI } from "@/lib/brand-logo";
import { OG_FONTS } from "@/lib/og-fonts";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export interface OgStat {
  /** Large figure, e.g. "99.9%". Keep it short — this is rendered at 34px. */
  value: string;
  /** Caption under the figure, e.g. "UPTIME". Upper-cased when rendered. */
  label: string;
}

export interface OgCardOptions {
  /** Product word shown next to "Circuvent", e.g. "Mail". Omit for the suite. */
  product?: string;
  /** Host shown top-right, e.g. "mail.circuvent.com". */
  domain: string;
  /** First headline line, rendered in white. */
  headline: string;
  /** Second headline line, rendered in the accent colour. */
  headlineAccent: string;
  /** Thin line under the headline, e.g. "Inbox · Calendar · Contacts". */
  tagline: string;
  /** Up to four figures along the bottom. Fewer is fine. */
  stats?: OgStat[];
  /** Accent colour for the second headline line and the glow. */
  accent?: string;
  /** Secondary glow colour, used bottom-right. */
  accentAlt?: string;
}

const DEFAULT_ACCENT = "#22d3ee";
const DEFAULT_ACCENT_ALT = "#7c3aed";

/**
 * `#rrggbbaa` is not reliably parsed by satori's colour handling, and a colour
 * it cannot parse degrades to transparent — which reads as "the gradient just
 * did not render". Expanding to `rgba()` here keeps the call sites plain hex.
 */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Vertical and horizontal hairlines.
 *
 * Drawn as explicit elements rather than a `repeating-linear-gradient` because
 * satori's gradient support is narrower than a browser's, and a background that
 * silently renders as flat black is exactly the kind of regression that never
 * shows up in a unit test.
 */
function GridLines() {
  const columns = Array.from({ length: 15 }, (_, i) => (i + 1) * 80);
  const rows = Array.from({ length: 7 }, (_, i) => (i + 1) * 80);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: "flex",
      }}
    >
      {columns.map((x) => (
        <div
          key={`c${x}`}
          style={{
            position: "absolute",
            left: x,
            top: 0,
            width: 1,
            height: OG_SIZE.height,
            background: "rgba(148, 163, 184, 0.09)",
          }}
        />
      ))}
      {rows.map((y) => (
        <div
          key={`r${y}`}
          style={{
            position: "absolute",
            left: 0,
            top: y,
            width: OG_SIZE.width,
            height: 1,
            background: "rgba(148, 163, 184, 0.09)",
          }}
        />
      ))}
    </div>
  );
}

export function ogCard(options: OgCardOptions) {
  const {
    product,
    domain,
    headline,
    headlineAccent,
    tagline,
    stats = [],
    accent = DEFAULT_ACCENT,
    accentAlt = DEFAULT_ACCENT_ALT,
  } = options;

  return (
    <div
      style={{
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: "#050b16",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Accent wash behind the wordmark, secondary behind the stats.
          Both layers carry explicit dimensions: satori will not paint a
          background on a box whose size it cannot compute, and `inset: 0`
          alone leaves it at zero -- which renders as a flat black card with no
          error anywhere. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          display: "flex",
          backgroundImage: `radial-gradient(900px 640px at 6% -14%, ${rgba(accent, 0.34)} 0%, ${rgba(accent, 0.08)} 45%, rgba(5,11,22,0) 72%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          display: "flex",
          backgroundImage: `radial-gradient(820px 760px at 100% 112%, ${rgba(accentAlt, 0.46)} 0%, ${rgba(accentAlt, 0.12)} 42%, rgba(5,11,22,0) 70%)`,
        }}
      />
      <GridLines />

      {/* Accent rule along the very top — the one element that reads even in a
          32px-tall preview thumbnail. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: 6,
          display: "flex",
          backgroundImage: `linear-gradient(90deg, ${accent} 0%, ${accentAlt} 100%)`,
        }}
      />

      {/* ── masthead ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "58px 72px 0 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <img
            src={LOGO_MARK_DATA_URI}
            width={78}
            height={78}
            alt=""
            style={{ marginRight: 24 }}
          />
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 44,
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-0.02em",
              }}
            >
              Circuvent
            </span>
            <span
              style={{
                fontSize: 40,
                fontWeight: 400,
                color: "#94a3b8",
                marginLeft: 14,
                letterSpacing: "-0.01em",
              }}
            >
              {product ?? "Technologies"}
            </span>
          </div>
        </div>
        <span style={{ fontSize: 24, color: "#8fa3bd" }}>{domain}</span>
      </div>

      {/* ── headline ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "0 72px",
          marginTop: 62,
        }}
      >
        <span
          style={{
            fontSize: 82,
            fontWeight: 700,
            color: "#ffffff",
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
          }}
        >
          {headline}
        </span>
        <span
          style={{
            fontSize: 82,
            fontWeight: 700,
            color: accent,
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
          }}
        >
          {headlineAccent}
        </span>
        <span
          style={{
            fontSize: 30,
            color: "#cbd5e1",
            marginTop: 22,
            letterSpacing: "0.005em",
          }}
        >
          {tagline}
        </span>
      </div>

      {/* ── stats ────────────────────────────────────────────────── */}
      {stats.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            position: "absolute",
            left: 72,
            bottom: 56,
          }}
        >
          {stats.slice(0, 4).map((stat, index) => (
            <div
              key={stat.label}
              style={{
                display: "flex",
                flexDirection: "column",
                marginRight: index === stats.length - 1 ? 0 : 58,
              }}
            >
              <span style={{ fontSize: 34, fontWeight: 700, color: "#ffffff" }}>
                {stat.value}
              </span>
              <span
                style={{
                  fontSize: 17,
                  color: "#8fa3bd",
                  marginTop: 6,
                  letterSpacing: "0.09em",
                }}
              >
                {stat.label.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Builds the PNG response for an `opengraph-image` / `twitter-image` route. */
export function ogImageResponse(options: OgCardOptions): ImageResponse {
  return new ImageResponse(ogCard(options), { ...OG_SIZE, fonts: OG_FONTS });
}

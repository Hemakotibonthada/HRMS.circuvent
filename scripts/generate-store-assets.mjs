// ═══════════════════════════════════════════════════════════════
// STORE ASSETS — generated, not committed by hand
// ═══════════════════════════════════════════════════════════════
// Produces every image the Play Console asks for, plus the app's own icon and
// splash, from one source: the palette in mobile/src/theme/tokens.ts.
//
// Generated rather than exported from a design tool and dropped in, for the
// same reason src/lib/color/web-palette.test.ts parses the real stylesheet
// instead of a copy of it. Fifteen WCAG failures were found in the shipped
// palette last time somebody kept a second copy of the colours; a store icon
// in last quarter's violet is a smaller version of the same problem.
//
// The palette is read out of the TypeScript rather than restated here. If the
// parse finds nothing the script fails loudly — a generator that silently
// produced black squares because a regex stopped matching would be the
// "two drift checks passed over an empty set" defect again.
//
// Run: npm run assets:store

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = join(repoRoot, "mobile");
const assetsDir = join(mobileRoot, "assets");
const storeDir = join(mobileRoot, "store", "play");
const shotsDir = join(storeDir, "screenshots", "phone");

const FONT = "Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif";

// ─── The palette, read from the app's own tokens ─────────────

/** Extracts one exported colour object from tokens.ts. */
function readScheme(source, name) {
  const block = new RegExp(`export const ${name}: ColorScheme = \\{([\\s\\S]*?)\\n\\};`).exec(source);
  if (!block) throw new Error(`Could not find "${name}" in mobile/src/theme/tokens.ts`);

  const colours = {};
  const entry = /^\s*(\w+):\s*"([^"]+)"/gm;
  let match;
  while ((match = entry.exec(block[1])) !== null) colours[match[1]] = match[2];

  // The guard that matters. A regex that stops matching after a refactor would
  // otherwise produce an empty object and a set of black images that look
  // deliberate.
  const required = ["background", "surfaceElevated", "text", "textMuted", "primary", "onPrimary", "border", "success", "warning", "danger", "successSubtle", "primarySubtle"];
  const missing = required.filter((key) => !colours[key]);
  if (missing.length > 0) {
    throw new Error(`Parsed ${name} but it is missing: ${missing.join(", ")}. The tokens file has changed shape.`);
  }
  return colours;
}

const tokensSource = readFileSync(join(mobileRoot, "src", "theme", "tokens.ts"), "utf8");
const light = readScheme(tokensSource, "lightColors");
const dark = readScheme(tokensSource, "darkColors");

// ─── SVG helpers ─────────────────────────────────────────────

const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function text(x, y, content, o = {}) {
  const anchor = o.anchor ?? "start";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size ?? 45}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? light.text}" text-anchor="${anchor}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${esc(content)}</text>`;
}

function rect(x, y, w, h, o = {}) {
  const stroke = o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.strokeWidth ?? 2}"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 0}" fill="${o.fill ?? "none"}"${stroke}/>`;
}

/**
 * Approximate rendered width of a string.
 *
 * Used only to size pills around their own label. 0.55em per character is a
 * reasonable average for a UI sans at these weights; being a little generous
 * is safe, being tight clips the word.
 */
const widthOf = (content, size) => Math.ceil(String(content).length * size * 0.56);

function pill(x, y, label, o = {}) {
  const size = o.size ?? 33;
  const padding = o.padding ?? 22;
  const height = o.height ?? size + 26;
  const width = widthOf(label, size) + padding * 2;
  return {
    width,
    svg:
      rect(x, y, width, height, { rx: height / 2, fill: o.bg }) +
      text(x + width / 2, y + height / 2 + size * 0.36, label, {
        size,
        weight: 600,
        fill: o.fg,
        anchor: "middle",
      }),
  };
}

// ─── The mark ────────────────────────────────────────────────
// A building, echoing the Building2 glyph the web app uses in its own header,
// drawn from rectangles rather than traced from an icon set so there is no
// question about what is being redistributed.

function mark(size, colour) {
  const u = size / 100;
  const parts = [];

  // Tower.
  parts.push(rect(30 * u, 22 * u, 26 * u, 56 * u, { fill: colour, rx: 2.5 * u }));
  // Annexe.
  parts.push(rect(58 * u, 40 * u, 20 * u, 38 * u, { fill: colour, rx: 2.5 * u }));

  // Windows, knocked out in the background colour so the mark reads as a
  // building rather than a bar chart at 48dp.
  const window = (cx, cy) => rect(cx * u, cy * u, 6 * u, 6 * u, { fill: "rgba(0,0,0,0.28)", rx: 1 * u });
  for (const row of [30, 42, 54, 66]) {
    parts.push(window(36, row));
    parts.push(window(46, row));
  }
  for (const row of [50, 62]) parts.push(window(64, row));

  return parts.join("");
}

function iconSvg(size) {
  const r = size * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${light.primary}"/>
      <stop offset="100%" stop-color="#5B21B6"/>
    </linearGradient>
  </defs>
  ${rect(0, 0, size, size, { fill: "url(#g)", rx: r })}
  ${mark(size, "#FFFFFF")}
</svg>`;
}

/**
 * Adaptive icon foreground.
 *
 * Android masks this to a shape that can be as small as the central 66%, so
 * the mark is drawn at 60% of the canvas and centred. A foreground that fills
 * its square gets its corners cut off on every device with a circular mask.
 */
function adaptiveSvg(size) {
  const inner = size * 0.6;
  const offset = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${offset}, ${offset})">${mark(inner, "#FFFFFF")}</g>
</svg>`;
}

/** Notification icon: a white silhouette on transparency, which is all Android keeps. */
function notificationSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${size * 0.1}, ${size * 0.1})">${mark(size * 0.8, "#FFFFFF")}</g>
</svg>`;
}

function splashSvg(width, height, scheme) {
  const markSize = Math.round(Math.min(width, height) * 0.28);
  const x = (width - markSize) / 2;
  const y = (height - markSize) / 2 - markSize * 0.3;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${rect(0, 0, width, height, { fill: scheme.background })}
  <g transform="translate(${x}, ${y})">${mark(markSize, scheme.primary)}</g>
  ${text(width / 2, y + markSize + markSize * 0.42, "Circuvent HR", { size: markSize * 0.16, weight: 700, fill: scheme.text, anchor: "middle" })}
</svg>`;
}

function featureGraphicSvg() {
  const w = 1024;
  const h = 500;
  const markSize = 150;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2E1065"/>
      <stop offset="60%" stop-color="${light.primary}"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  ${rect(0, 0, w, h, { fill: "url(#bg)" })}
  <circle cx="880" cy="90" r="230" fill="rgba(255,255,255,0.06)"/>
  <circle cx="120" cy="470" r="190" fill="rgba(255,255,255,0.05)"/>
  <g transform="translate(72, ${h / 2 - markSize / 2 - 34})">${mark(markSize, "#FFFFFF")}</g>
  ${text(250, 232, "Circuvent HR", { size: 68, weight: 700, fill: "#FFFFFF" })}
  ${text(250, 296, "Clock in, book leave, read your payslip", { size: 34, weight: 400, fill: "rgba(255,255,255,0.86)" })}
  ${text(250, 348, "Works without a signal", { size: 34, weight: 600, fill: "rgba(255,255,255,0.96)" })}
</svg>`;
}

// ─── Screenshot furniture ────────────────────────────────────
// 1080 × 1920 is 360 × 640 dp at 3×, so every dp in the app is 3 px here and
// the layout is the app's own spacing scale rather than an invented one.

const W = 1080;
const H = 1920;
const S = 3;
const PAD = 16 * S;
const CARD_R = 10 * S;

// The vertical budget, stated once. Everything a screen draws must sit between
// these, and screenFrame refuses to write a file that does not — a row sliding
// under the tab bar is the sort of thing nobody notices until it is on the
// listing, because the generator was happy and the file existed.
const CAPTION_Y = 100 * S;
const HEADER_Y = 152 * S;
const CONTENT_TOP = 176 * S;
const CONTENT_BOTTOM = H - 74 * S - 12 * S;

function statusBar(scheme) {
  return [
    rect(0, 0, W, 30 * S, { fill: scheme.background }),
    text(PAD, 21 * S, "9:41", { size: 13 * S, weight: 600, fill: scheme.text }),
    rect(W - PAD - 26 * S, 11 * S, 22 * S, 10 * S, { rx: 3, fill: scheme.text }),
    rect(W - PAD - 52 * S, 11 * S, 8 * S, 10 * S, { rx: 2, fill: scheme.text }),
    rect(W - PAD - 40 * S, 8 * S, 10 * S, 13 * S, { rx: 2, fill: scheme.text }),
  ].join("");
}

function header(scheme, title) {
  return text(PAD, HEADER_Y, title, { size: 20 * S, weight: 700, fill: scheme.text });
}

function tabBar(scheme, activeIndex) {
  const height = 74 * S;
  const top = H - height;
  const labels = ["Today", "Leave", "Shifts", "Pay", "Profile"];
  const parts = [
    rect(0, top, W, height, { fill: scheme.surfaceElevated }),
    rect(0, top, W, 2, { fill: scheme.border }),
  ];

  const slot = W / labels.length;
  labels.forEach((label, index) => {
    const active = index === activeIndex;
    const colour = active ? scheme.primary : scheme.textMuted;
    const cx = slot * index + slot / 2;
    const cy = top + 24 * S;

    // Simple geometric glyphs rather than a traced icon set.
    if (index === 0) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${10 * S}" fill="none" stroke="${colour}" stroke-width="${2.2 * S}"/>`);
      parts.push(`<path d="M ${cx} ${cy - 5 * S} L ${cx} ${cy} L ${cx + 5 * S} ${cy}" stroke="${colour}" stroke-width="${2.2 * S}" fill="none" stroke-linecap="round"/>`);
    } else if (index === 1) {
      parts.push(rect(cx - 10 * S, cy - 9 * S, 20 * S, 19 * S, { rx: 2 * S, stroke: colour, strokeWidth: 2.2 * S }));
      parts.push(rect(cx - 10 * S, cy - 9 * S, 20 * S, 5 * S, { fill: colour }));
    } else if (index === 2) {
      parts.push(`<path d="M ${cx - 9 * S} ${cy - 3 * S} a ${9 * S} ${9 * S} 0 1 1 ${3 * S} ${8 * S}" stroke="${colour}" stroke-width="${2.2 * S}" fill="none" stroke-linecap="round"/>`);
      parts.push(`<path d="M ${cx - 13 * S} ${cy - 7 * S} L ${cx - 9 * S} ${cy - 3 * S} L ${cx - 5 * S} ${cy - 8 * S}" stroke="${colour}" stroke-width="${2.2 * S}" fill="none" stroke-linecap="round"/>`);
    } else if (index === 3) {
      parts.push(rect(cx - 8 * S, cy - 10 * S, 16 * S, 20 * S, { rx: 2 * S, stroke: colour, strokeWidth: 2.2 * S }));
      parts.push(rect(cx - 4 * S, cy - 4 * S, 8 * S, 1.6 * S, { fill: colour }));
      parts.push(rect(cx - 4 * S, cy + 1 * S, 8 * S, 1.6 * S, { fill: colour }));
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy - 4 * S}" r="${5 * S}" fill="none" stroke="${colour}" stroke-width="${2.2 * S}"/>`);
      parts.push(`<path d="M ${cx - 9 * S} ${cy + 10 * S} a ${9 * S} ${8 * S} 0 0 1 ${18 * S} 0" stroke="${colour}" stroke-width="${2.2 * S}" fill="none" stroke-linecap="round"/>`);
    }

    parts.push(text(cx, top + 46 * S, label, {
      size: 12 * S,
      weight: active ? 600 : 400,
      fill: colour,
      anchor: "middle",
    }));
  });

  return parts.join("");
}

function caption(scheme, line) {
  // No background rect here. An earlier version painted one from y=0, which
  // covered the status bar it was drawn after — the screenshot looked like a
  // phone with no clock and no battery.
  return text(W / 2, CAPTION_Y, line, {
    size: 21 * S,
    weight: 700,
    fill: scheme.text,
    anchor: "middle",
  });
}

function card(x, y, w, h, scheme, o = {}) {
  return rect(x, y, w, h, {
    rx: CARD_R,
    fill: o.muted ? scheme.surface ?? scheme.background : scheme.surfaceElevated,
    stroke: o.highlight ? scheme.primary : scheme.border,
    strokeWidth: o.highlight ? 2 * S : 1.2,
  });
}

function screenFrame(name, scheme, captionLine, screen, activeTab) {
  // The guard. A screen that draws past the tab bar is a broken screenshot,
  // and one that stops far short of it is a half-empty one; both are worth
  // being told about rather than discovering on the listing.
  if (screen.bottom > CONTENT_BOTTOM) {
    throw new Error(
      `${name}: content ends at ${Math.round(screen.bottom)}px, past the tab bar at ${CONTENT_BOTTOM}px. Trim a row.`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${rect(0, 0, W, H, { fill: scheme.background })}
  ${statusBar(scheme)}
  ${caption(scheme, captionLine)}
  ${screen.svg}
  ${tabBar(scheme, activeTab)}
</svg>`;
}

// ─── The screens ─────────────────────────────────────────────

function todayScreen(scheme) {
  const parts = [header(scheme, "Today")];
  let y = CONTENT_TOP;

  parts.push(text(PAD, y, "Hello, Asha", { size: 15 * S, fill: scheme.textMuted }));
  y += 14 * S;

  const cardH = 196 * S;
  parts.push(card(PAD, y, W - PAD * 2, cardH, scheme));
  parts.push(text(PAD + 24 * S, y + 48 * S, "You are clocked in", { size: 24 * S, weight: 700, fill: scheme.text }));

  [["In", "09:02"], ["Out", "—"], ["Worked", "6h 18m"]].forEach(([label, value], index) => {
    const x = PAD + 24 * S + index * ((W - PAD * 2 - 48 * S) / 3);
    parts.push(text(x, y + 86 * S, label, { size: 12 * S, fill: scheme.textMuted }));
    parts.push(text(x, y + 112 * S, value, { size: 17 * S, weight: 600, fill: scheme.text }));
  });

  parts.push(rect(PAD + 24 * S, y + 132 * S, W - PAD * 2 - 48 * S, 48 * S, { rx: CARD_R, fill: scheme.surfaceElevated, stroke: scheme.border, strokeWidth: 2 }));
  parts.push(text(W / 2, y + 163 * S, "Clock out", { size: 17 * S, weight: 600, fill: scheme.text, anchor: "middle" }));
  y += cardH + 14 * S;

  const banner = (top, bg, edge, fg, title, body) => {
    const h = 64 * S;
    parts.push(rect(PAD, top, W - PAD * 2, h, { rx: CARD_R, fill: bg }));
    parts.push(rect(PAD, top, 3 * S, h, { rx: 2, fill: edge }));
    parts.push(text(PAD + 22 * S, top + 26 * S, title, { size: 13 * S, weight: 600, fill: fg }));
    parts.push(text(PAD + 22 * S, top + 48 * S, body, { size: 13 * S, fill: fg }));
    return h;
  };

  y += banner(y, scheme.successSubtle, scheme.success, scheme.success, "Clocked in", "Recorded at the Whitefield office.");
  y += 10 * S;
  y += banner(y, scheme.surface ?? scheme.background, scheme.border, scheme.textMuted, "1 action waiting to be sent", "It will go when you have a connection.");

  return { svg: parts.join(""), bottom: y };
}

function shiftsScreen(scheme) {
  const parts = [header(scheme, "Shifts")];
  let y = CONTENT_TOP;

  const heroH = 146 * S;
  parts.push(card(PAD, y, W - PAD * 2, heroH, scheme, { highlight: true }));
  parts.push(text(PAD + 24 * S, y + 34 * S, "NEXT SHIFT", { size: 12 * S, weight: 600, fill: scheme.primary, spacing: 2 }));
  parts.push(text(PAD + 24 * S, y + 74 * S, "Late shift", { size: 20 * S, weight: 700, fill: scheme.text }));
  parts.push(text(PAD + 24 * S, y + 104 * S, "Tomorrow, 14:00 to 22:00", { size: 15 * S, fill: scheme.textMuted }));
  parts.push(text(PAD + 24 * S, y + 130 * S, "8h · finishes the next day", { size: 13 * S, fill: scheme.textMuted }));
  parts.push(pill(W - PAD - widthOf("Overnight", 12 * S) - 66 * S, y + 20 * S, "Overnight", {
    size: 12 * S,
    bg: scheme.primarySubtle,
    fg: scheme.primary,
  }).svg);
  y += heroH + 20 * S;

  const days = [
    ["Tomorrow", "8h", ["Late shift", "14:00 – 22:00 · 8h", "Overnight"]],
    ["Thu 12 Mar", "8h", ["Early shift", "06:00 – 14:00 · 8h", null]],
  ];

  for (const [label, total, row] of days) {
    parts.push(text(PAD, y, label, { size: 13 * S, weight: 600, fill: scheme.textMuted }));
    parts.push(text(W - PAD, y, total, { size: 13 * S, fill: scheme.textMuted, anchor: "end" }));
    y += 14 * S;

    const [name, times, badge] = row;
    parts.push(card(PAD, y, W - PAD * 2, 74 * S, scheme));
    parts.push(text(PAD + 22 * S, y + 32 * S, name, { size: 15 * S, weight: 500, fill: scheme.text }));
    parts.push(text(PAD + 22 * S, y + 58 * S, times, { size: 13 * S, fill: scheme.textMuted }));
    if (badge) {
      parts.push(pill(W - PAD - widthOf(badge, 12 * S) - 66 * S, y + 20 * S, badge, {
        size: 12 * S,
        bg: scheme.primarySubtle,
        fg: scheme.primary,
      }).svg);
    }
    y += 74 * S + 18 * S;
  }

  return { svg: parts.join(""), bottom: y - 18 * S };
}

function leaveScreen(scheme) {
  const parts = [header(scheme, "Leave")];
  let y = CONTENT_TOP;

  parts.push(rect(PAD, y, W - PAD * 2, 50 * S, { rx: CARD_R, fill: scheme.primary }));
  parts.push(text(W / 2, y + 32 * S, "Apply for leave", { size: 17 * S, weight: 600, fill: scheme.onPrimary, anchor: "middle" }));
  y += 50 * S + 24 * S;

  parts.push(text(PAD, y, "Your balance", { size: 20 * S, weight: 600, fill: scheme.text }));
  y += 14 * S;

  [["Casual", "12", "of 18 days"], ["Sick", "6", "of 12 days"], ["Earned", "21", "of 24 days"]].forEach(
    ([label, value, of], index) => {
      const w = (W - PAD * 2 - 16 * S) / 3;
      const x = PAD + index * (w + 8 * S);
      parts.push(card(x, y, w, 92 * S, scheme));
      parts.push(text(x + 16 * S, y + 28 * S, label, { size: 12 * S, fill: scheme.textMuted }));
      parts.push(text(x + 16 * S, y + 60 * S, value, { size: 24 * S, weight: 700, fill: scheme.text }));
      parts.push(text(x + 16 * S, y + 82 * S, of, { size: 12 * S, fill: scheme.textMuted }));
    }
  );
  y += 92 * S + 24 * S;

  parts.push(text(PAD, y, "Your requests", { size: 20 * S, weight: 600, fill: scheme.text }));
  y += 14 * S;

  const requests = [
    ["Casual", "10 Mar – 12 Mar · 3 days", "Approved", scheme.successSubtle, scheme.success],
    ["Earned", "02 Apr – 09 Apr · 8 days", "Pending", scheme.warningSubtle, scheme.warning],
  ];

  for (const [type, span, status, bg, fg] of requests) {
    parts.push(card(PAD, y, W - PAD * 2, 74 * S, scheme));
    parts.push(text(PAD + 22 * S, y + 32 * S, type, { size: 15 * S, weight: 500, fill: scheme.text }));
    parts.push(text(PAD + 22 * S, y + 58 * S, span, { size: 13 * S, fill: scheme.textMuted }));
    parts.push(pill(W - PAD - widthOf(status, 12 * S) - 66 * S, y + 20 * S, status, { size: 12 * S, bg, fg }).svg);
    y += 74 * S + 10 * S;
  }

  return { svg: parts.join(""), bottom: y - 10 * S };
}

function payslipsScreen(scheme) {
  const parts = [header(scheme, "Payslips")];
  let y = CONTENT_TOP;

  const slips = [
    ["February 2026", "₹84,320.00", "Net pay"],
    ["January 2026", "₹84,320.00", "Net pay"],
    ["December 2025", "₹91,470.00", "Net pay"],
    ["November 2025", "₹80,110.00", "Net pay · 2 days loss of pay"],
  ];

  for (const [period, amount, note] of slips) {
    parts.push(card(PAD, y, W - PAD * 2, 82 * S, scheme));
    parts.push(text(PAD + 22 * S, y + 36 * S, period, { size: 15 * S, weight: 500, fill: scheme.text }));
    parts.push(text(W - PAD - 22 * S, y + 36 * S, amount, { size: 17 * S, weight: 600, fill: scheme.text, anchor: "end" }));
    parts.push(text(PAD + 22 * S, y + 62 * S, note, { size: 13 * S, fill: scheme.textMuted }));
    y += 82 * S + 10 * S;
  }

  return { svg: parts.join(""), bottom: y - 10 * S };
}

function attendanceScreen(scheme) {
  const parts = [header(scheme, "Attendance")];
  let y = CONTENT_TOP;

  parts.push(text(W / 2, y + 20 * S, "March 2026", { size: 17 * S, weight: 600, fill: scheme.text, anchor: "middle" }));
  parts.push(`<path d="M ${PAD + 26 * S} ${y + 4 * S} L ${PAD + 14 * S} ${y + 15 * S} L ${PAD + 26 * S} ${y + 26 * S}" stroke="${scheme.text}" stroke-width="${2.4 * S}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(`<path d="M ${W - PAD - 26 * S} ${y + 4 * S} L ${W - PAD - 14 * S} ${y + 15 * S} L ${W - PAD - 26 * S} ${y + 26 * S}" stroke="${scheme.textMuted}" stroke-width="${2.4 * S}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>`);
  y += 44 * S;

  const summaryH = 132 * S;
  parts.push(card(PAD, y, W - PAD * 2, summaryH, scheme));

  const quarter = (W - PAD * 2 - 44 * S) / 4;
  [["Present", "20"], ["Absent", "1"], ["Leave", "2"], ["Remote", "3"]].forEach(([label, value], index) => {
    const x = PAD + 22 * S + index * quarter;
    parts.push(text(x, y + 30 * S, label, { size: 12 * S, fill: scheme.textMuted }));
    parts.push(text(x, y + 58 * S, value, { size: 20 * S, weight: 700, fill: scheme.text }));
  });

  parts.push(rect(PAD + 22 * S, y + 74 * S, W - PAD * 2 - 44 * S, 1.5, { fill: scheme.border }));
  [["Worked", "160h"], ["Average day", "8h"]].forEach(([label, value], index) => {
    const x = PAD + 22 * S + index * ((W - PAD * 2 - 44 * S) / 2);
    parts.push(text(x, y + 98 * S, label, { size: 12 * S, fill: scheme.textMuted }));
    parts.push(text(x, y + 122 * S, value, { size: 18 * S, weight: 700, fill: scheme.text }));
  });
  y += summaryH + 18 * S;

  const days = [
    ["Tue, 10 Mar", "09:02 – 18:20 · 8h 48m", "Present", scheme.successSubtle, scheme.success],
    ["Mon, 9 Mar", "09:34 – 18:30 · 8h 26m", "Late", scheme.warningSubtle, scheme.warning],
  ];

  for (const [day, times, status, bg, fg] of days) {
    parts.push(card(PAD, y, W - PAD * 2, 74 * S, scheme));
    parts.push(text(PAD + 22 * S, y + 32 * S, day, { size: 15 * S, weight: 500, fill: scheme.text }));
    parts.push(text(PAD + 22 * S, y + 58 * S, times, { size: 13 * S, fill: scheme.textMuted }));
    parts.push(pill(W - PAD - widthOf(status, 12 * S) - 66 * S, y + 20 * S, status, { size: 12 * S, bg, fg }).svg);
    y += 74 * S + 10 * S;
  }

  return { svg: parts.join(""), bottom: y - 10 * S };
}

// ─── Write everything ────────────────────────────────────────

function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function png(svg, file, expected) {
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(buffer).metadata();

  // Asserted rather than assumed. Play rejects an icon that is 511 px, and
  // finding that out in the Console is a slow way to learn it.
  if (expected && (meta.width !== expected[0] || meta.height !== expected[1])) {
    throw new Error(`${file}: expected ${expected[0]}×${expected[1]}, produced ${meta.width}×${meta.height}`);
  }

  writeFileSync(file, buffer);
  return `${meta.width}×${meta.height}`;
}

async function main() {
  ensure(assetsDir);
  ensure(storeDir);
  ensure(shotsDir);

  const written = [];

  // App assets.
  written.push(["mobile/assets/icon.png", await png(iconSvg(1024), join(assetsDir, "icon.png"), [1024, 1024])]);
  written.push(["mobile/assets/adaptive-icon.png", await png(adaptiveSvg(1024), join(assetsDir, "adaptive-icon.png"), [1024, 1024])]);
  written.push(["mobile/assets/notification-icon.png", await png(notificationSvg(96), join(assetsDir, "notification-icon.png"), [96, 96])]);
  written.push(["mobile/assets/splash.png", await png(splashSvg(1284, 2778, light), join(assetsDir, "splash.png"), [1284, 2778])]);
  written.push(["mobile/assets/splash-dark.png", await png(splashSvg(1284, 2778, dark), join(assetsDir, "splash-dark.png"), [1284, 2778])]);

  // Play listing assets.
  written.push(["store/play/icon-512.png", await png(iconSvg(512), join(storeDir, "icon-512.png"), [512, 512])]);
  written.push(["store/play/feature-graphic.png", await png(featureGraphicSvg(), join(storeDir, "feature-graphic.png"), [1024, 500])]);

  // Screenshots, light mode. Play wants at least two; four to eight is the
  // range that actually gets looked at.
  const screens = [
    ["01-today", todayScreen, "Clock in, even with no signal", 0],
    ["02-shifts", shiftsScreen, "Know when you are next in", 2],
    ["03-leave", leaveScreen, "Book leave in three taps", 1],
    ["04-payslips", payslipsScreen, "Every payslip, whenever you need it", 3],
    ["05-attendance", attendanceScreen, "Your own attendance, month by month", 0],
  ];

  for (const [name, build, captionLine, tab] of screens) {
    const svg = screenFrame(name, light, captionLine, build(light), tab);
    written.push([
      `store/play/screenshots/phone/${name}.png`,
      await png(svg, join(shotsDir, `${name}.png`), [W, H]),
    ]);
  }

  // One in dark mode, because the app follows the OS and a good share of the
  // people looking at the listing are in dark mode while they do it.
  written.push([
    "store/play/screenshots/phone/06-today-dark.png",
    await png(
      screenFrame("06-today-dark", dark, "Follows your phone's dark mode", todayScreen(dark), 0),
      join(shotsDir, "06-today-dark.png"),
      [W, H]
    ),
  ]);

  for (const [file, size] of written) console.log(`  ${size.padStart(11)}  ${file}`);
  console.log(`\n${written.length} assets written from the palette in mobile/src/theme/tokens.ts`);
}

main().catch((error) => {
  console.error("Store asset generation failed:", error.message);
  process.exit(1);
});

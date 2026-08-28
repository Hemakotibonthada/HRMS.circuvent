// ═══════════════════════════════════════════════════════════════
// Android and Play Store image assets, generated from the vector
// ═══════════════════════════════════════════════════════════════
//
// The launcher icon is defined once, as the adaptive icon's vector drawable.
// Everything else here is rendered from that same file: the density PNGs, the
// round variant, the 512px Play listing icon and the feature graphic. Nothing
// is drawn twice.
//
// That matters more than it sounds. The usual way this goes wrong is that
// somebody exports a store icon from a design tool, the mark is later nudged in
// the app, and the listing quietly shows a different logo from the home screen
// for a year. Reading the same drawable the build reads makes that impossible.
//
//   npm run android:assets
//
// Outputs are written into the Android res tree and into the fastlane metadata
// layout, which is what `fastlane supply` and Gradle Play Publisher upload from.

import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * sharp is not declared as a dependency of this project.
 *
 * It arrives as an optional dependency of Next, which is enough for a task run
 * by hand but not a promise: `npm ci --omit=optional` leaves it out, and an
 * optional dependency that fails to build is skipped silently. Declaring it
 * directly would be more honest, except the lockfile pins it as optional and
 * regenerating that is a bigger change than an asset script warrants.
 *
 * So it is imported dynamically and the failure is made to say what to do,
 * rather than surfacing as a bare module-not-found from a script somebody runs
 * once a year.
 */
let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.log(
    "\nThis script needs sharp, which is not installed.\n" +
      "  npm install --no-save sharp\n"
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "android", "app", "src", "main", "res");
const play = path.join(root, "android", "fastlane", "metadata", "android", "en-US", "images");

/** The adaptive icon canvas, in the units the vector drawable is authored in. */
const CANVAS = 108;

/**
 * The portion of the canvas a launcher is guaranteed to show.
 *
 * An adaptive icon reserves the outer 18 units on each side for masking and
 * parallax, leaving the central 72 always visible. Rendering the store icon at
 * the same 108/72 scale is what makes the listing match the home screen; render
 * the full canvas instead and the mark looks noticeably smaller in the store
 * than on the device.
 */
const SAFE = 72;
const SCALE = CANVAS / SAFE;

/** Density buckets and the launcher icon size each one expects, in pixels. */
const DENSITIES = [
  { dir: "mipmap-mdpi", size: 48 },
  { dir: "mipmap-hdpi", size: 72 },
  { dir: "mipmap-xhdpi", size: 96 },
  { dir: "mipmap-xxhdpi", size: 144 },
  { dir: "mipmap-xxxhdpi", size: 192 },
];

/**
 * Converts an Android colour literal to something SVG understands.
 *
 * Android writes eight-digit colours as #AARRGGBB — alpha first — while SVG and
 * CSS read the same eight digits as #RRGGBBAA, alpha last. The two are silently
 * incompatible: #47000000 is a soft black in Android and a transparent near-red
 * in a browser. Converting explicitly, rather than passing the string through,
 * is the difference between a shaded window and an invisible one.
 */
function androidColour(literal) {
  const hex = literal.replace("#", "").trim();
  if (hex.length === 8) {
    const alpha = parseInt(hex.slice(0, 2), 16) / 255;
    return { fill: `#${hex.slice(2)}`, opacity: alpha };
  }
  if (hex.length === 6) return { fill: `#${hex}`, opacity: 1 };
  if (hex.length === 4) {
    const [a, r, g, b] = hex;
    return { fill: `#${r}${r}${g}${g}${b}${b}`, opacity: parseInt(a + a, 16) / 255 };
  }
  if (hex.length === 3) {
    const [r, g, b] = hex;
    return { fill: `#${r}${r}${g}${g}${b}${b}`, opacity: 1 };
  }
  throw new Error(`Cannot read Android colour "${literal}"`);
}

/** Pulls the fill and outline of every path out of a vector drawable. */
async function readVector(file) {
  const xml = await readFile(file, "utf8");
  const paths = [];
  const re = /<path\b[^>]*?>/gs;
  for (const [tag] of xml.matchAll(re)) {
    const data = /android:pathData\s*=\s*"([^"]+)"/s.exec(tag);
    const colour = /android:fillColor\s*=\s*"([^"]+)"/s.exec(tag);
    if (!data) continue;
    const { fill, opacity } = androidColour(colour ? colour[1] : "#FF000000");
    paths.push({ d: data[1].replace(/\s+/g, " ").trim(), fill, opacity });
  }
  if (paths.length === 0) throw new Error(`No paths found in ${file}`);

  const invisible = paths.filter((p) => p.opacity === 0);
  if (invisible.length > 0) {
    console.log(
      `  warning: ${invisible.length} path(s) are fully transparent and will not ` +
        `appear. An #AARRGGBB literal with a leading 00 is the usual cause.`
    );
  }
  return paths;
}

/** Reads a named colour out of a values/colors.xml. */
async function readColour(file, name) {
  const xml = await readFile(file, "utf8");
  const m = new RegExp(`<color\\s+name="${name}"\\s*>([^<]+)</color>`).exec(xml);
  if (!m) throw new Error(`No colour "${name}" in ${file}`);
  return m[1].trim();
}

/** The full 108-unit adaptive icon, background and foreground, as an SVG. */
function iconSvg(paths, background, size) {
  const body = paths
    .map((p) => `<path d="${p.d}" fill="${p.fill}" fill-opacity="${p.opacity}"/>`)
    .join("\n    ");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">
    <rect width="${CANVAS}" height="${CANVAS}" fill="${background}"/>
    ${body}
  </svg>`
  );
}

/**
 * Renders the icon the way a launcher does: the canvas scaled up, then cropped
 * to the guaranteed-visible centre.
 */
async function renderIcon(paths, background, size) {
  const full = Math.round(size * SCALE);
  const inset = Math.round((full - size) / 2);
  return sharp(iconSvg(paths, background, full))
    .extract({ left: inset, top: inset, width: size, height: size })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Applies a circular mask, for the round launcher variant. */
async function roundOff(square, size) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>
    </svg>`
  );
  return sharp(square)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The 1024x500 graphic at the top of the store listing.
 *
 * The mark is rendered on its own, trimmed to its true bounding box, and then
 * placed — rather than positioned by hand from the coordinates in the drawable.
 * The artwork sits well inside its 108-unit canvas, so scaling the canvas puts
 * a small building in a large circle; trimming measures whatever the artwork
 * actually is, and keeps measuring it if somebody redraws it.
 *
 * Flattened onto an opaque background because Play rejects an alpha channel
 * here, and a feature graphic that fails validation blocks the whole release.
 */
async function featureGraphic(paths, background) {
  const w = 1024;
  const h = 500;
  const circle = { cx: 246, cy: h / 2, r: 150 };
  const markHeight = 196;

  const body = paths
    .map((p) => `<path d="${p.d}" fill="${p.fill}" fill-opacity="${p.opacity}"/>`)
    .join("\n    ");

  const mark = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 ${CANVAS} ${CANVAS}">
    ${body}
  </svg>`
    )
  )
    .trim()
    .resize({ height: markHeight })
    .png()
    .toBuffer();

  const { width: markWidth } = await sharp(mark).metadata();

  const canvas = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5B21D6"/>
      <stop offset="55%" stop-color="${background}"/>
      <stop offset="100%" stop-color="#9061FF"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="#FFFFFF" fill-opacity="0.10"/>
  <text x="440" y="228" font-family="Segoe UI, Roboto, Arial, sans-serif"
        font-size="78" font-weight="700" fill="#FFFFFF">Circuvent HR</text>
  <text x="443" y="292" font-family="Segoe UI, Roboto, Arial, sans-serif"
        font-size="34" font-weight="400" fill="#FFFFFF" fill-opacity="0.88">Attendance, leave and payslips</text>
  <text x="443" y="340" font-family="Segoe UI, Roboto, Arial, sans-serif"
        font-size="34" font-weight="400" fill="#FFFFFF" fill-opacity="0.88">for your whole team</text>
</svg>`
  );

  return sharp(canvas)
    .composite([
      {
        input: mark,
        left: Math.round(circle.cx - markWidth / 2),
        top: Math.round(circle.cy - markHeight / 2),
      },
    ])
    .flatten({ background })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const paths = await readVector(path.join(res, "drawable", "ic_launcher_foreground.xml"));
  const background = await readColour(path.join(res, "values", "colors.xml"), "ic_launcher_background");

  console.log(`\nMark: ${paths.length} paths on ${background}\n`);

  for (const { dir, size } of DENSITIES) {
    const target = path.join(res, dir);
    await mkdir(target, { recursive: true });

    const square = await renderIcon(paths, background, size);
    await writeFile(path.join(target, "ic_launcher.png"), square);
    await writeFile(path.join(target, "ic_launcher_round.png"), await roundOff(square, size));

    console.log(`  ${dir.padEnd(16)} ${size}x${size}  square + round`);
  }

  await mkdir(play, { recursive: true });

  // Play wants 512 exactly, and shows it at a fraction of that, so it is
  // rendered from the vector rather than upscaled from the largest mipmap.
  const store = await renderIcon(paths, background, 512);
  await writeFile(path.join(play, "icon.png"), await sharp(store).flatten({ background }).png().toBuffer());
  console.log(`\n  play icon        512x512   opaque`);

  await writeFile(path.join(play, "featureGraphic.png"), await featureGraphic(paths, background));
  console.log(`  feature graphic  1024x500  opaque\n`);
}

main().catch((e) => {
  console.log("ERROR:", e.message);
  process.exitCode = 1;
});

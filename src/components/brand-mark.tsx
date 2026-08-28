/* eslint-disable @next/next/no-img-element */
// The Circuvent mark.
//
// Two things this component exists to get right, both learned the hard way.
//
// First, every app used to draw its own stand-in — an envelope, a briefcase, a
// building glyph in a coloured box — so the company had a different logo on
// each hostname.
//
// Second, and less obvious: the mark is roughly forty thin dashes around a
// hollow centre. Handing a browser the 512px master for a 32px header slot
// makes it do a single 16:1 downscale, which spreads each dash across a
// fraction of a pixel — the logo came out pale and broken rather than small.
// So the sizes below are pre-rendered offline with the alpha density restored,
// and this picks the nearest one at or above the requested size. The browser
// then scales by a small factor, or not at all.

/** Pre-rendered widths available under public/. Keep in step with the assets. */
const AVAILABLE = [32, 64, 96, 128] as const;

function sourceFor(size: number): string {
  // Match the device-pixel size, not the CSS size: a 32px slot on a 2x screen
  // paints 64 real pixels, and feeding it a 32px file makes it soft again.
  const target = size * 2;
  const pick = AVAILABLE.find((w) => w >= target);
  return pick ? `/logo-mark-${pick}.png` : "/logo-mark.png";
}

interface BrandMarkProps {
  /** Rendered size in px. The artwork is square. */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 32, className }: BrandMarkProps) {
  return (
    <img
      src={sourceFor(size)}
      width={size}
      height={size}
      // Decorative wherever it sits beside the company name, which is every
      // current use. A screen reader announcing "Circuvent logo, Circuvent
      // Mail" is noise.
      alt=""
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
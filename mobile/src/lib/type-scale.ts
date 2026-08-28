// ═══════════════════════════════════════════════════════════════
// TYPE SCALE — keeping line height in step with the OS text size
// ═══════════════════════════════════════════════════════════════
// React Native scales `fontSize` by the operating system's text-size setting
// and leaves `lineHeight` exactly as written. The theme states line heights in
// absolute points — it has to, because React Native's `lineHeight` is points
// and not a ratio — so the two come apart the moment somebody turns their text
// size up:
//
//     fontSize 15 → 30 at 200%          lineHeight 22 → 22
//
// Thirty-point glyphs on a twenty-two-point line overlap and clip. Descenders
// go first, then whole rows. This affects every screen in the app, and it
// affects exactly the people who changed the setting because they were having
// trouble reading it in the first place. WCAG 1.4.4 asks for 200% without loss
// of content; this loses content at about 130%.
//
// The fix is to apply the same multiplier to both. Not a *capped* multiplier:
// capping the line height while the glyphs keep growing is worse than doing
// nothing, because it guarantees the overlap instead of merely permitting it.
// If a caller ever caps the font size — `maxFontSizeMultiplier` on a Text —
// it must pass the same cap here, which is why that is a parameter rather
// than a constant.
//
// There is deliberately no `scaledFontSize`. React Native already scales the
// font; doing it again here would square the multiplier and produce 4× text
// at a 2× setting.

/**
 * Line height in points, adjusted for the OS text-size setting.
 *
 * @param lineHeight  The designed line height, in points, from the theme.
 * @param fontScale   `useWindowDimensions().fontScale` — 1 at the default size.
 * @param maxFontSizeMultiplier
 *        The same cap applied to the font, if any. Omit it when the font is
 *        uncapped, which is the normal case.
 */
export function scaledLineHeight(
  lineHeight: number,
  fontScale: number,
  maxFontSizeMultiplier?: number
): number {
  // A line height that is not a usable number is passed straight back. Layout
  // is not the place to discover that a token is wrong, and a NaN line height
  // collapses the row to nothing.
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return lineHeight;

  // A scale that cannot be read leaves the design untouched. This is the value
  // on the first frame of some platforms, and guessing at it would make text
  // jump on launch.
  if (!Number.isFinite(fontScale) || fontScale <= 0) return lineHeight;

  const capped =
    maxFontSizeMultiplier !== undefined &&
    Number.isFinite(maxFontSizeMultiplier) &&
    maxFontSizeMultiplier > 0
      ? Math.min(fontScale, maxFontSizeMultiplier)
      : fontScale;

  // Never tightened below the design. React Native does shrink the glyphs at a
  // scale under 1, but pulling the leading in with them buys a line of screen
  // space at the cost of clipping descenders — and the people on the smallest
  // setting are the ones with the least margin for it.
  if (capped <= 1) return lineHeight;

  // Rounded to whole points. Sub-point line heights are legal but land on
  // different physical pixels from row to row, which makes a long list look
  // unevenly spaced.
  return Math.round(lineHeight * capped);
}

/**
 * The ratio a variant was designed at, e.g. 22/15 for body text.
 *
 * Exported for the test that pins the invariant: after scaling, the ratio
 * between line height and font size must be the one the designer chose. That
 * is the property the whole module exists to preserve, and it is the one a
 * future "let's cap the leading, it looks airy" change would break.
 */
export function leading(lineHeight: number, fontSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 0;
  return lineHeight / fontSize;
}

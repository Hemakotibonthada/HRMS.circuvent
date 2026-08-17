/* eslint-disable @next/next/no-img-element */
// Favicon.
//
// The mark is drawn on transparency, not on a coloured tile. An earlier version
// put it on a dark rounded square, which is fine for a home-screen icon but
// wrong in a browser tab: the tab strip supplies its own background, so the
// tile just reads as a black box with a small logo inside it.
//
// Same inlined artwork the OG card uses, so the tab icon and the link preview
// cannot drift apart.
import { ImageResponse } from "next/og";
import { LOGO_MARK_DATA_URI } from "@/lib/brand-logo";

export const size = { width: 32, height: 32 };
// ImageResponse always emits PNG; declaring anything else mislabels the bytes.
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img src={LOGO_MARK_DATA_URI} width={32} height={32} alt="" />
      </div>
    ),
    { ...size },
  );
}
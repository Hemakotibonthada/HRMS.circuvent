/* eslint-disable @next/next/no-img-element */
// iOS home-screen icon.
//
// White rather than transparent: iOS ignores the manifest here, reads this link
// tag, and flattens any alpha to black — a transparent tile becomes a black
// square on the home screen. White is the background the brand artwork is drawn
// for, so the mark reads the same as it does in the header.
import { ImageResponse } from "next/og";
import { LOGO_MARK_DATA_URI } from "@/lib/brand-logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        <img src={LOGO_MARK_DATA_URI} width={140} height={140} alt="" />
      </div>
    ),
    { ...size },
  );
}
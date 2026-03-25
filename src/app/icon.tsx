import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/x-icon";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 20,
          background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          borderRadius: "6px",
          fontWeight: 800,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        H
      </div>
    ),
    { ...size }
  );
}

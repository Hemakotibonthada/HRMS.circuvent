import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 80,
          background: "linear-gradient(135deg, #7c3aed, #6d28d9, #4f46e5)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          borderRadius: "36px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>HR</div>
      </div>
    ),
    { ...size }
  );
}

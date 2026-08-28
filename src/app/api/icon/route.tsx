import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const size = parseInt(searchParams.get("size") || "192");

  return new ImageResponse(
    (
      <div
        style={{
          fontSize: size * 0.45,
          background: "linear-gradient(135deg, #7c3aed, #6d28d9, #4f46e5)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          borderRadius: size * 0.15,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>HR</div>
        <div style={{ fontSize: size * 0.1, fontWeight: 500, opacity: 0.8, marginTop: size * 0.02 }}>
          Circuvent
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}

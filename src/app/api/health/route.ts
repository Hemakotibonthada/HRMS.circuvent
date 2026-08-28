import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Health Check & System Status
// ═══════════════════════════════════════════════════════════════

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "circuvent-hrms",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    features: {
      localAuth: process.env.NEXT_PUBLIC_USE_LOCAL_CREDS === "true",
    },
    uptime: process.uptime(),
  });
}

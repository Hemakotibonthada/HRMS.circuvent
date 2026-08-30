import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const database = db();
    const rows = await database
      .select()
      .from(deviceSecurityPolicies)
      .orderBy(desc(deviceSecurityPolicies.createdAt));

    return NextResponse.json({ devices: rows });
  } catch (error: any) {
    console.error("[GET /api/security/devices] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch devices" },
      { status: 500 }
    );
  }
}

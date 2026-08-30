import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceCommands, deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { organizations } from "@/db/schema/identity";
import { employees } from "@/db/schema/hrms";
import { eq, and, desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_COMMANDS = [
  "lock_device",
  "policy_refresh",
  "trigger_scan",
  "kill_process",
  "quarantine_app",
  "wipe_cache",
];

// ─── POST /api/security/devices/commands — Issue Remote Command ───
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      deviceHostname,
      commandType,
      payload = {},
      issuedById,
      issuedByEmail = "admin@circuvent.com",
    } = body;

    if (!deviceHostname || !commandType) {
      return NextResponse.json(
        { error: "deviceHostname and commandType are required" },
        { status: 400 }
      );
    }

    if (!VALID_COMMANDS.includes(commandType)) {
      return NextResponse.json(
        { error: `Invalid commandType. Must be one of: ${VALID_COMMANDS.join(", ")}` },
        { status: 400 }
      );
    }

    const database = db();
    const cleanHostname = deviceHostname.toUpperCase().trim();

    // 1. Resolve Target Devices
    let targetDevices = [];
    if (cleanHostname === "ALL") {
      targetDevices = await database.select().from(deviceSecurityPolicies);
    } else {
      const single = await database.query.deviceSecurityPolicies.findFirst({
        where: eq(deviceSecurityPolicies.deviceHostname, cleanHostname),
      });
      if (single) {
        targetDevices.push(single);
      }
    }

    if (targetDevices.length === 0) {
      return NextResponse.json(
        { error: `No registered device found for hostname '${cleanHostname}'` },
        { status: 404 }
      );
    }

    // 2. Queue Commands
    const createdCommands = [];
    for (const dev of targetDevices) {
      const [cmd] = await database
        .insert(deviceCommands)
        .values({
          orgId: dev.orgId,
          deviceId: dev.id,
          deviceHostname: dev.deviceHostname,
          commandType,
          payload,
          status: "pending",
          issuedById: issuedById || null,
          issuedByEmail,
          issuedAt: new Date(),
        })
        .returning();
      createdCommands.push(cmd);
    }

    return NextResponse.json({
      success: true,
      queuedCount: createdCommands.length,
      commands: createdCommands,
    });
  } catch (error: any) {
    console.error("[POST /api/security/devices/commands] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to dispatch remote command" },
      { status: 500 }
    );
  }
}

// ─── GET /api/security/devices/commands — List Command Execution History ───
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceHostname = searchParams.get("deviceHostname");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const database = db();
    const whereConditions: any[] = [];

    if (deviceHostname) {
      whereConditions.push(eq(deviceCommands.deviceHostname, deviceHostname.toUpperCase().trim()));
    }
    if (status && status !== "all") {
      whereConditions.push(eq(deviceCommands.status, status));
    }

    const items = await database
      .select()
      .from(deviceCommands)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(deviceCommands.issuedAt))
      .limit(limit);

    return NextResponse.json({ commands: items });
  } catch (error: any) {
    console.error("[GET /api/security/devices/commands] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch command history" },
      { status: 500 }
    );
  }
}

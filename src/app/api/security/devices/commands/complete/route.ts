import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceCommands } from "@/db/schema/security-incidents";
import { eq } from "drizzle-orm";
import { deviceKeyFromRequest, resolveDeviceAgentKey } from "@/lib/device-agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const agent = await resolveDeviceAgentKey(deviceKeyFromRequest(req));
    if (!agent) {
      return NextResponse.json(
        { error: "X-Device-Agent-Key is required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const {
      commandId,
      deviceHostname,
      status = "completed",
      resultOutput = "Command executed successfully.",
      errorMessage = null,
    } = body;

    if (!commandId) {
      return NextResponse.json(
        { error: "commandId is required" },
        { status: 400 }
      );
    }

    if (deviceHostname) {
      const cleanHostname = deviceHostname.toUpperCase().trim();
      if (cleanHostname !== agent.deviceHostname) {
        return NextResponse.json({ error: "Hostname does not match agent key" }, { status: 403 });
      }
    }

    const database = db();
    const [updated] = await database
      .update(deviceCommands)
      .set({
        status,
        resultOutput: resultOutput ? String(resultOutput).slice(0, 4000) : null,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 2000) : null,
        executedAt: new Date(),
      })
      .where(eq(deviceCommands.id, commandId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Command not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      command: updated,
    });
  } catch (error: any) {
    console.error("[POST /api/security/devices/commands/complete] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to complete command execution" },
      { status: 500 }
    );
  }
}

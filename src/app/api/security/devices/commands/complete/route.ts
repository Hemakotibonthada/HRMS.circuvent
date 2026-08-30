import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceCommands } from "@/db/schema/security-incidents";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
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

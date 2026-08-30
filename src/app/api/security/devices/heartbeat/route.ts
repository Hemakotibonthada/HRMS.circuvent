import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      deviceHostname,
      agentVersion,
      osVersion,
      usbBlocked = true,
      firewallActive = true,
    } = body;

    if (!deviceHostname) {
      return NextResponse.json(
        { error: "deviceHostname is required" },
        { status: 400 }
      );
    }

    const database = db();
    const existing = await database.query.deviceSecurityPolicies.findFirst({
      where: eq(deviceSecurityPolicies.deviceHostname, deviceHostname.toUpperCase()),
    });

    if (existing) {
      await database
        .update(deviceSecurityPolicies)
        .set({
          lastHeartbeatAt: new Date(),
          agentVersion: agentVersion || existing.agentVersion,
          osVersion: osVersion || existing.osVersion,
          usbBlocked: usbBlocked !== undefined ? usbBlocked : existing.usbBlocked,
          firewallActive: firewallActive !== undefined ? firewallActive : existing.firewallActive,
          updatedAt: new Date(),
        })
        .where(eq(deviceSecurityPolicies.id, existing.id));

      return NextResponse.json({
        success: true,
        enforcePolicy: {
          usbBlocked: existing.usbBlocked,
          firewallActive: existing.firewallActive,
          policyMode: existing.policyMode,
        },
      });
    }

    return NextResponse.json({
      success: true,
      enforcePolicy: {
        usbBlocked: true,
        firewallActive: true,
        policyMode: "strict_block",
      },
    });
  } catch (error: any) {
    console.error("[POST /api/security/devices/heartbeat] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process heartbeat" },
      { status: 500 }
    );
  }
}

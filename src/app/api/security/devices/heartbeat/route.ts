import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceSecurityPolicies, deviceCommands, securityIncidents } from "@/db/schema/security-incidents";
import { eq, and } from "drizzle-orm";
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
      deviceHostname,
      agentVersion,
      osVersion,
      osFamily,
      osBuild,
      usbBlocked = true,
      firewallActive = true,
      encryptionStatus,
      encryptionType,
      missingPatchesCount,
      pendingUpdates,
      hardwareSpecs,
    } = body;

    if (!deviceHostname) {
      return NextResponse.json(
        { error: "deviceHostname is required" },
        { status: 400 }
      );
    }

    const database = db();
    const cleanHostname = deviceHostname.toUpperCase().trim();
    if (cleanHostname !== agent.deviceHostname) {
      return NextResponse.json({ error: "Hostname does not match agent key" }, { status: 403 });
    }
    const existing = await database.query.deviceSecurityPolicies.findFirst({
      where: and(
        eq(deviceSecurityPolicies.deviceHostname, cleanHostname),
        eq(deviceSecurityPolicies.orgId, agent.orgId)
      ),
    });

    // 1. Calculate Real-Time Compliance Score
    let score = 100;
    const resolvedEncryptionStatus = encryptionStatus || existing?.encryptionStatus || "unknown";
    const resolvedEncryptionType = encryptionType || existing?.encryptionType || "none";
    const resolvedPatchesCount = typeof missingPatchesCount === "number" ? missingPatchesCount : (existing?.missingPatchesCount ?? 0);
    const resolvedUsbBlocked = usbBlocked !== undefined ? usbBlocked : (existing?.usbBlocked ?? true);
    const resolvedFirewallActive = firewallActive !== undefined ? firewallActive : (existing?.firewallActive ?? true);

    if (resolvedEncryptionStatus === "unencrypted") {
      score -= 40;
    } else if (resolvedEncryptionStatus === "unknown") {
      score -= 15;
    }

    if (resolvedPatchesCount > 0) {
      score -= Math.min(40, resolvedPatchesCount * 10);
    }

    if (!resolvedUsbBlocked) {
      score -= 25;
    }

    if (!resolvedFirewallActive) {
      score -= 20;
    }

    score = Math.max(0, Math.min(100, score));

    let complianceStatus = "compliant";
    if (score < 60 || resolvedEncryptionStatus === "unencrypted") {
      complianceStatus = "critical_risk";
    } else if (score < 90 || resolvedPatchesCount > 0) {
      complianceStatus = "warning";
    }

    // Trigger incident if unencrypted device detected for the first time
    if (resolvedEncryptionStatus === "unencrypted" && existing && existing.encryptionStatus !== "unencrypted") {
      await database.insert(securityIncidents).values({
        orgId: existing.orgId,
        employeeId: existing.employeeId,
        employeeEmail: existing.employeeEmail,
        employeeCode: existing.employeeCode,
        deviceHostname: cleanHostname,
        deviceSerial: existing.deviceSerial,
        incidentType: "disk_encryption_disabled",
        severity: "critical",
        actionTaken: "compliance_warning_issued",
        metadata: {
          osFamily: osFamily || existing.osFamily,
          osVersion: osVersion || existing.osVersion,
          detectedAt: new Date().toISOString(),
        },
        status: "open",
      });
    }

    // 2. Update Device Policy in DB
    if (existing) {
      await database
        .update(deviceSecurityPolicies)
        .set({
          lastHeartbeatAt: new Date(),
          agentVersion: agentVersion || existing.agentVersion,
          osVersion: osVersion || existing.osVersion,
          osFamily: osFamily || existing.osFamily,
          osBuild: osBuild || existing.osBuild,
          usbBlocked: resolvedUsbBlocked,
          firewallActive: resolvedFirewallActive,
          encryptionStatus: resolvedEncryptionStatus,
          encryptionType: resolvedEncryptionType,
          missingPatchesCount: resolvedPatchesCount,
          pendingUpdates: pendingUpdates !== undefined ? pendingUpdates : existing.pendingUpdates,
          lastPatchScanAt: pendingUpdates !== undefined ? new Date() : existing.lastPatchScanAt,
          hardwareSpecs: hardwareSpecs || existing.hardwareSpecs,
          complianceScore: score,
          complianceStatus,
          updatedAt: new Date(),
        })
        .where(eq(deviceSecurityPolicies.id, existing.id));
    }

    // 3. Retrieve Pending Remote Commands for this Hostname
    const pendingCmds = await database
      .select()
      .from(deviceCommands)
      .where(
        and(
          eq(deviceCommands.deviceHostname, cleanHostname),
          eq(deviceCommands.status, "pending")
        )
      );

    // Mark retrieved commands as "sent"
    if (pendingCmds.length > 0) {
      for (const cmd of pendingCmds) {
        await database
          .update(deviceCommands)
          .set({ status: "sent" })
          .where(eq(deviceCommands.id, cmd.id));
      }
    }

    return NextResponse.json({
      success: true,
      enforcePolicy: {
        usbBlocked: resolvedUsbBlocked,
        firewallActive: resolvedFirewallActive,
        policyMode: existing?.policyMode || "strict_block",
      },
      compliance: {
        score,
        status: complianceStatus,
      },
      pendingCommands: pendingCmds.map((c) => ({
        id: c.id,
        commandType: c.commandType,
        payload: c.payload,
        issuedAt: c.issuedAt,
      })),
    });
  } catch (error: any) {
    console.error("[POST /api/security/devices/heartbeat] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process heartbeat" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { employees } from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orgId,
      deviceHostname,
      deviceSerial,
      employeeId: rawEmployeeId,
      employeeCode,
      employeeEmail,
      policyMode = "strict_block",
      usbBlocked = true,
      firewallActive = true,
      agentVersion = "2.4.0",
      osVersion = "Windows 11 Enterprise",
    } = body;

    if (!deviceHostname) {
      return NextResponse.json(
        { error: "deviceHostname is required" },
        { status: 400 }
      );
    }

    const database = db();

    // 1. Resolve Organization ID
    let resolvedOrgId = orgId;
    if (!resolvedOrgId) {
      const org = await database.query.organizations.findFirst({
        columns: { id: true },
      });
      resolvedOrgId = org?.id;
    }

    if (!resolvedOrgId) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    // 2. Resolve Employee if specified
    let employeeId: string | null = rawEmployeeId || null;
    if (!employeeId && (employeeEmail || employeeCode)) {
      const emp = await database.query.employees.findFirst({
        where: (e: any, { or, eq }: any) =>
          or(
            employeeEmail ? eq(e.workEmail, employeeEmail.toLowerCase()) : undefined,
            employeeCode ? eq(e.employeeCode, employeeCode.toUpperCase()) : undefined
          ),
      });
      if (emp) {
        employeeId = emp.id;
      }
    }

    // 3. Upsert device security policy record
    const existing = await database.query.deviceSecurityPolicies.findFirst({
      where: eq(deviceSecurityPolicies.deviceHostname, deviceHostname.toUpperCase()),
    });

    let resultDevice;
    if (existing) {
      const [updated] = await database
        .update(deviceSecurityPolicies)
        .set({
          deviceSerial: deviceSerial || existing.deviceSerial,
          employeeId: employeeId || existing.employeeId,
          employeeCode: employeeCode ? employeeCode.toUpperCase() : existing.employeeCode,
          employeeEmail: employeeEmail ? employeeEmail.toLowerCase() : existing.employeeEmail,
          policyMode,
          usbBlocked,
          firewallActive,
          agentVersion,
          osVersion,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deviceSecurityPolicies.id, existing.id))
        .returning();
      resultDevice = updated;
    } else {
      const [inserted] = await database
        .insert(deviceSecurityPolicies)
        .values({
          orgId: resolvedOrgId,
          deviceHostname: deviceHostname.toUpperCase(),
          deviceSerial: deviceSerial || null,
          employeeId,
          employeeCode: employeeCode ? employeeCode.toUpperCase() : null,
          employeeEmail: employeeEmail ? employeeEmail.toLowerCase() : null,
          policyMode,
          usbBlocked,
          firewallActive,
          agentVersion,
          osVersion,
          lastHeartbeatAt: new Date(),
        })
        .returning();
      resultDevice = inserted;
    }

    return NextResponse.json({
      success: true,
      device: resultDevice,
      policy: {
        usbBlocked: resultDevice.usbBlocked,
        firewallActive: resultDevice.firewallActive,
        policyMode: resultDevice.policyMode,
      },
    });
  } catch (error: any) {
    console.error("[POST /api/security/devices/enroll] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to enroll device" },
      { status: 500 }
    );
  }
}

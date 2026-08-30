import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { assets, assetCategories, assetEvents } from "@/db/schema/assets";
import { employees } from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import { and, eq } from "drizzle-orm";
import {
  consumeEnrollToken,
  deviceKeyFromRequest,
  enrollTokenFromRequest,
  issueDeviceAgentKey,
  resolveDeviceAgentKey,
} from "@/lib/device-agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizeAgent(req: NextRequest, body: Record<string, unknown>) {
  const enrollRaw =
    enrollTokenFromRequest(req) ??
    (typeof body.enrollToken === "string" ? body.enrollToken : null);
  if (enrollRaw) {
    const claims = await consumeEnrollToken(enrollRaw);
    if (!claims) {
      return {
        error: NextResponse.json(
          { error: "Enroll token is invalid or expired" },
          { status: 401 }
        ),
      };
    }
    return {
      orgId: claims.orgId,
      employeeEmail: claims.employeeEmail,
      employeeCode: claims.employeeCode,
      employeeId: claims.employeeId,
      viaEnrollToken: true as const,
    };
  }

  const agentKey = deviceKeyFromRequest(req);
  if (!agentKey) {
    return {
      error: NextResponse.json(
        { error: "X-Device-Enroll-Token or X-Device-Agent-Key is required" },
        { status: 401 }
      ),
    };
  }
  const agent = await resolveDeviceAgentKey(agentKey);
  if (!agent) {
    return {
      error: NextResponse.json({ error: "Device agent key is invalid" }, { status: 401 }),
    };
  }
  return { orgId: agent.orgId, agent, viaEnrollToken: false as const };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orgId,
      deviceHostname,
      deviceSerial,
      manufacturer,
      model,
      processor,
      ramGb,
      diskGb,
      macAddress,
      employeeId: rawEmployeeId,
      employeeCode,
      employeeEmail,
      policyMode = "strict_block",
      usbBlocked = true,
      firewallActive = true,
      agentVersion = "2.5.0",
      osVersion = "Windows 11 Enterprise",
      osFamily = "windows", // "windows" | "macos" | "linux"
      osBuild,
      encryptionStatus = "unknown", // "encrypted" | "unencrypted" | "encrypting" | "unknown"
      encryptionType = "none", // "bitlocker" | "filevault" | "luks" | "none"
      missingPatchesCount = 0,
      pendingUpdates = [],
      hardwareSpecs = {},
    } = body;

    const auth = await authorizeAgent(req, body);
    if ("error" in auth) return auth.error;

    if (!deviceHostname) {
      return NextResponse.json(
        { error: "deviceHostname is required" },
        { status: 400 }
      );
    }

    const database = db();
    const cleanHostname = deviceHostname.toUpperCase().trim();

    // 1. Resolve Organization ID (from enroll token / agent key — never trust body alone)
    let resolvedOrgId = auth.orgId ?? orgId;
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
    let employeeId: string | null = rawEmployeeId || auth.employeeId || null;
    let employeeRecord: any = null;
    const resolvedEmail =
      auth.employeeEmail ?? (employeeEmail ? employeeEmail.toLowerCase() : null);
    const resolvedCode =
      auth.employeeCode ?? (employeeCode ? employeeCode.toUpperCase() : null);

    if (resolvedEmail || resolvedCode) {
      employeeRecord = await database.query.employees.findFirst({
        where: (e: any, { or, eq, and }: any) =>
          and(
            eq(e.orgId, resolvedOrgId),
            or(
              resolvedEmail ? eq(e.workEmail, resolvedEmail) : undefined,
              resolvedCode ? eq(e.employeeCode, resolvedCode) : undefined
            )
          ),
      });
      if (employeeRecord) {
        employeeId = employeeRecord.id;
      }
    } else if (rawEmployeeId) {
      employeeRecord = await database.query.employees.findFirst({
        where: (e: any, { eq, and }: any) =>
          and(eq(e.id, rawEmployeeId), eq(e.orgId, resolvedOrgId)),
      });
    }

    const issuedEmail = resolvedEmail ?? (employeeEmail ? employeeEmail.toLowerCase() : null);
    const issuedCode = resolvedCode ?? (employeeCode ? employeeCode.toUpperCase() : null);

    // 3. Compute Initial Compliance Score
    let complianceScore = 100;
    if (encryptionStatus === "unencrypted") complianceScore -= 40;
    if (missingPatchesCount > 0) complianceScore -= Math.min(40, missingPatchesCount * 10);
    if (!usbBlocked) complianceScore -= 25;
    if (!firewallActive) complianceScore -= 20;
    complianceScore = Math.max(0, Math.min(100, complianceScore));

    let complianceStatus = "compliant";
    if (complianceScore < 60 || encryptionStatus === "unencrypted") {
      complianceStatus = "critical_risk";
    } else if (complianceScore < 90 || missingPatchesCount > 0) {
      complianceStatus = "warning";
    }

    const mergedHardwareSpecs = {
      processor: processor || hardwareSpecs?.processor,
      ramGb: ramGb || hardwareSpecs?.ramGb,
      diskGb: diskGb || hardwareSpecs?.diskGb,
      macAddress: macAddress || hardwareSpecs?.macAddress,
      manufacturer: manufacturer || hardwareSpecs?.manufacturer,
      model: model || hardwareSpecs?.model,
      ...hardwareSpecs,
    };

    // 4. Upsert device security policy record
    const existingPolicy = await database.query.deviceSecurityPolicies.findFirst({
      where: eq(deviceSecurityPolicies.deviceHostname, cleanHostname),
    });

    let resultDevice;
    if (existingPolicy) {
      const [updated] = await database
        .update(deviceSecurityPolicies)
        .set({
          deviceSerial: deviceSerial || existingPolicy.deviceSerial,
          employeeId: employeeId || existingPolicy.employeeId,
          employeeCode: issuedCode ?? existingPolicy.employeeCode,
          employeeEmail: issuedEmail ?? existingPolicy.employeeEmail,
          policyMode,
          usbBlocked,
          firewallActive,
          agentVersion,
          osVersion,
          osFamily: osFamily || existingPolicy.osFamily,
          osBuild: osBuild || existingPolicy.osBuild,
          encryptionStatus: encryptionStatus !== "unknown" ? encryptionStatus : existingPolicy.encryptionStatus,
          encryptionType: encryptionType !== "none" ? encryptionType : existingPolicy.encryptionType,
          missingPatchesCount: missingPatchesCount !== undefined ? missingPatchesCount : existingPolicy.missingPatchesCount,
          pendingUpdates: pendingUpdates.length > 0 ? pendingUpdates : existingPolicy.pendingUpdates,
          hardwareSpecs: mergedHardwareSpecs,
          complianceScore,
          complianceStatus,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deviceSecurityPolicies.id, existingPolicy.id))
        .returning();
      resultDevice = updated;
    } else {
      const [inserted] = await database
        .insert(deviceSecurityPolicies)
        .values({
          orgId: resolvedOrgId,
          deviceHostname: cleanHostname,
          deviceSerial: deviceSerial || null,
          employeeId,
          employeeCode: issuedCode,
          employeeEmail: issuedEmail,
          policyMode,
          usbBlocked,
          firewallActive,
          agentVersion,
          osVersion,
          osFamily,
          osBuild: osBuild || null,
          encryptionStatus,
          encryptionType,
          missingPatchesCount,
          pendingUpdates,
          hardwareSpecs: mergedHardwareSpecs,
          complianceScore,
          complianceStatus,
          lastHeartbeatAt: new Date(),
        })
        .returning();
      resultDevice = inserted;
    }

    // 5. Auto-register / Sync into HRMS Asset Management (`assets` table)
    let registeredAsset: any = null;
    try {
      let laptopCategory = await database.query.assetCategories.findFirst({
        where: (cat: any, { eq, and }: any) =>
          and(eq(cat.orgId, resolvedOrgId), eq(cat.code, "laptop")),
      });

      if (!laptopCategory) {
        const [newCat] = await database
          .insert(assetCategories)
          .values({
            orgId: resolvedOrgId,
            name: "Laptops & Workstations",
            code: "laptop",
            defaultUsefulLifeMonths: 36,
            defaultMethod: "straight_line",
            defaultSalvagePercent: 5,
            maxPerEmployee: 1,
            serviceIntervalMonths: 12,
            requiresAcceptance: true,
            isActive: true,
          })
          .returning();
        laptopCategory = newCat;
      }

      const cleanSerial = deviceSerial?.trim() || null;
      let existingAsset = cleanSerial
        ? await database.query.assets.findFirst({
            where: (a: any, { and, eq }: any) =>
              and(eq(a.orgId, resolvedOrgId), eq(a.serialNumber, cleanSerial)),
          })
        : null;

      if (!existingAsset) {
        existingAsset = await database.query.assets.findFirst({
          where: (a: any, { and, eq }: any) =>
            and(
              eq(a.orgId, resolvedOrgId),
              eq(a.assetTag, `CIR-AST-${cleanHostname}`)
            ),
        });
      }

      const osFamilyTitle = osFamily === "macos" ? "MacBook / Mac" : osFamily === "linux" ? "Linux Workstation" : "Windows Laptop";
      const assetName = manufacturer && model
        ? `${manufacturer} ${model}`
        : `${manufacturer || "Enterprise"} ${osFamilyTitle} (${cleanHostname})`;

      const assetNotes = [
        `Auto-enrolled via Circuvent Endpoint Security Guard (${osFamily.toUpperCase()}).`,
        osVersion ? `OS: ${osVersion}` : null,
        processor ? `CPU: ${processor}` : null,
        ramGb ? `RAM: ${ramGb} GB` : null,
        diskGb ? `Storage: ${diskGb} GB` : null,
        macAddress ? `MAC: ${macAddress}` : null,
        `Encryption: ${encryptionStatus.toUpperCase()} (${encryptionType.toUpperCase()})`,
      ]
        .filter(Boolean)
        .join(" | ");

      if (existingAsset) {
        const [updatedAsset] = await database
          .update(assets)
          .set({
            name: assetName,
            manufacturer: manufacturer || existingAsset.manufacturer,
            model: model || existingAsset.model,
            serialNumber: cleanSerial || existingAsset.serialNumber,
            assignedToId: employeeId || existingAsset.assignedToId,
            state: employeeId ? "assigned" : existingAsset.state,
            status: employeeId ? "assigned" : existingAsset.status,
            assignedAt: employeeId ? (existingAsset.assignedAt || new Date()) : existingAsset.assignedAt,
            notes: assetNotes,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, existingAsset.id))
          .returning();

        registeredAsset = updatedAsset;

        await database.insert(assetEvents).values({
          orgId: resolvedOrgId,
          assetId: existingAsset.id,
          action: "device_heartbeat_sync",
          fromState: existingAsset.state,
          toState: employeeId ? "assigned" : existingAsset.state,
          employeeId: employeeId || null,
          detail: `Multi-OS endpoint sync from ${cleanHostname} (${osFamily.toUpperCase()}). Serial: ${cleanSerial || "N/A"}`,
          metadata: {
            deviceHostname: cleanHostname,
            osFamily,
            osVersion,
            agentVersion,
            encryptionStatus,
            encryptionType,
            missingPatchesCount,
            processor,
            ramGb,
          },
        });
      } else {
        const tagSuffix = cleanSerial
          ? cleanSerial.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10)
          : cleanHostname;
        const generatedTag = `CIR-AST-${tagSuffix}`;

        const [newAsset] = await database
          .insert(assets)
          .values({
            orgId: resolvedOrgId,
            assetTag: generatedTag,
            name: assetName,
            category: "Laptops & Workstations",
            categoryId: laptopCategory?.id || null,
            serialNumber: cleanSerial,
            manufacturer: manufacturer || (osFamily === "macos" ? "Apple" : "Circuvent Managed"),
            model: model || (osFamily === "macos" ? "MacBook Pro" : "Corporate Laptop"),
            condition: "good",
            state: employeeId ? "assigned" : "in_stock",
            status: employeeId ? "assigned" : "available",
            assignedToId: employeeId || null,
            assignedAt: employeeId ? new Date() : null,
            notes: assetNotes,
          })
          .returning();

        registeredAsset = newAsset;

        await database.insert(assetEvents).values({
          orgId: resolvedOrgId,
          assetId: newAsset.id,
          action: "device_autoregistered",
          fromState: "in_stock",
          toState: employeeId ? "assigned" : "in_stock",
          employeeId: employeeId || null,
          detail: `Auto-enrolled from ${osFamily.toUpperCase()} endpoint ${cleanHostname} via Circuvent Endpoint Security Guard.`,
          metadata: {
            deviceHostname: cleanHostname,
            deviceSerial: cleanSerial,
            manufacturer,
            model,
            osFamily,
            osVersion,
            ramGb,
            processor,
            encryptionStatus,
            encryptionType,
          },
        });
      }
    } catch (assetErr: any) {
      console.warn("[POST /api/security/devices/enroll] Asset sync warning:", assetErr.message);
    }

    let deviceApiKey: string | undefined;
    if (resultDevice && auth.viaEnrollToken) {
      deviceApiKey = await issueDeviceAgentKey({
        orgId: resolvedOrgId,
        deviceId: resultDevice.id,
        deviceHostname: cleanHostname,
      });
    }

    return NextResponse.json({
      success: true,
      deviceApiKey,
      device: resultDevice,
      asset: registeredAsset
        ? {
            id: registeredAsset.id,
            assetTag: registeredAsset.assetTag,
            name: registeredAsset.name,
            serialNumber: registeredAsset.serialNumber,
            state: registeredAsset.state,
            assignedToId: registeredAsset.assignedToId,
          }
        : null,
      policy: {
        usbBlocked: resultDevice.usbBlocked,
        firewallActive: resultDevice.firewallActive,
        policyMode: resultDevice.policyMode,
        complianceScore: resultDevice.complianceScore,
        complianceStatus: resultDevice.complianceStatus,
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

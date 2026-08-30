import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { assets, assetCategories, assetEvents } from "@/db/schema/assets";
import { employees } from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import { eq, or } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    let employeeRecord: any = null;
    if (employeeEmail || employeeCode) {
      employeeRecord = await database.query.employees.findFirst({
        where: (e: any, { or, eq }: any) =>
          or(
            employeeEmail ? eq(e.workEmail, employeeEmail.toLowerCase()) : undefined,
            employeeCode ? eq(e.employeeCode, employeeCode.toUpperCase()) : undefined
          ),
      });
      if (employeeRecord) {
        employeeId = employeeRecord.id;
      }
    } else if (rawEmployeeId) {
      employeeRecord = await database.query.employees.findFirst({
        where: (e: any, { eq }: any) => eq(e.id, rawEmployeeId),
      });
    }

    // 3. Upsert device security policy record
    const existingPolicy = await database.query.deviceSecurityPolicies.findFirst({
      where: eq(deviceSecurityPolicies.deviceHostname, deviceHostname.toUpperCase()),
    });

    let resultDevice;
    if (existingPolicy) {
      const [updated] = await database
        .update(deviceSecurityPolicies)
        .set({
          deviceSerial: deviceSerial || existingPolicy.deviceSerial,
          employeeId: employeeId || existingPolicy.employeeId,
          employeeCode: employeeCode ? employeeCode.toUpperCase() : existingPolicy.employeeCode,
          employeeEmail: employeeEmail ? employeeEmail.toLowerCase() : existingPolicy.employeeEmail,
          policyMode,
          usbBlocked,
          firewallActive,
          agentVersion,
          osVersion,
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

    // 4. Auto-register / Sync into HRMS Asset Management (`assets` table)
    let registeredAsset: any = null;
    try {
      // Find or create "Laptops & Notebooks" category
      let laptopCategory = await database.query.assetCategories.findFirst({
        where: (cat: any, { eq, and }: any) =>
          and(eq(cat.orgId, resolvedOrgId), eq(cat.code, "laptop")),
      });

      if (!laptopCategory) {
        const [newCat] = await database
          .insert(assetCategories)
          .values({
            orgId: resolvedOrgId,
            name: "Laptops & Notebooks",
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

      // Check if asset already exists by serial number or asset tag matching hostname
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
              eq(a.assetTag, `CIR-AST-${deviceHostname.toUpperCase()}`)
            ),
        });
      }

      const assetName = manufacturer && model
        ? `${manufacturer} ${model}`
        : `${manufacturer || "Enterprise"} Laptop (${deviceHostname})`;

      const assetNotes = [
        `Auto-registered via Circuvent Endpoint Security Guard on ${deviceHostname}.`,
        osVersion ? `OS: ${osVersion}` : null,
        processor ? `CPU: ${processor}` : null,
        ramGb ? `RAM: ${ramGb} GB` : null,
        diskGb ? `Storage: ${diskGb} GB` : null,
        macAddress ? `MAC: ${macAddress}` : null,
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

        // Log audit event
        await database.insert(assetEvents).values({
          orgId: resolvedOrgId,
          assetId: existingAsset.id,
          action: "device_heartbeat_sync",
          fromState: existingAsset.state,
          toState: employeeId ? "assigned" : existingAsset.state,
          employeeId: employeeId || null,
          detail: `Endpoint policy sync from ${deviceHostname}. Serial: ${cleanSerial || "N/A"}`,
          metadata: {
            deviceHostname,
            osVersion,
            agentVersion,
            processor,
            ramGb,
          },
        });
      } else {
        const tagSuffix = cleanSerial
          ? cleanSerial.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10)
          : deviceHostname.toUpperCase();
        const generatedTag = `CIR-AST-${tagSuffix}`;

        const [newAsset] = await database
          .insert(assets)
          .values({
            orgId: resolvedOrgId,
            assetTag: generatedTag,
            name: assetName,
            category: "Laptops & Notebooks",
            categoryId: laptopCategory?.id || null,
            serialNumber: cleanSerial,
            manufacturer: manufacturer || "Circuvent Managed",
            model: model || "Corporate Laptop",
            condition: "good",
            state: employeeId ? "assigned" : "in_stock",
            status: employeeId ? "assigned" : "available",
            assignedToId: employeeId || null,
            assignedAt: employeeId ? new Date() : null,
            notes: assetNotes,
          })
          .returning();

        registeredAsset = newAsset;

        // Log creation event
        await database.insert(assetEvents).values({
          orgId: resolvedOrgId,
          assetId: newAsset.id,
          action: "device_autoregistered",
          fromState: "in_stock",
          toState: employeeId ? "assigned" : "in_stock",
          employeeId: employeeId || null,
          detail: `Auto-enrolled from Windows endpoint ${deviceHostname} via Circuvent Endpoint Security Guard.`,
          metadata: {
            deviceHostname,
            deviceSerial: cleanSerial,
            manufacturer,
            model,
            osVersion,
            ramGb,
            processor,
          },
        });
      }
    } catch (assetErr: any) {
      console.warn("[POST /api/security/devices/enroll] Non-fatal asset sync warning:", assetErr.message);
    }

    return NextResponse.json({
      success: true,
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

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  deviceInstalledSoftware,
  deviceSecurityPolicies,
  securityIncidents,
} from "@/db/schema/security-incidents";
import { employees } from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { deviceKeyFromRequest, resolveDeviceAgentKey } from "@/lib/device-agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── BLACKLIST & RISK DEFINITIONS ───
const BLACKLIST_RULES = [
  { pattern: /anydesk/i, category: "remote_access", risk: "critical", name: "AnyDesk Remote Desktop" },
  { pattern: /teamviewer/i, category: "remote_access", risk: "critical", name: "TeamViewer" },
  { pattern: /rustdesk/i, category: "remote_access", risk: "critical", name: "RustDesk Remote Access" },
  { pattern: /ammyy/i, category: "remote_access", risk: "critical", name: "Ammyy Admin" },
  { pattern: /logmein/i, category: "remote_access", risk: "critical", name: "LogMeIn" },
  { pattern: /tightvnc|ultravnc|realvnc/i, category: "remote_access", risk: "high", name: "VNC Remote Server" },
  { pattern: /bittorrent|utorrent|qbittorrent|transmission|deluge|vuze|frostwire/i, category: "p2p_sharing", risk: "critical", name: "P2P BitTorrent Client" },
  { pattern: /tor browser/i, category: "security", risk: "critical", name: "Tor Anonymity Browser" },
  { pattern: /wireshark/i, category: "security", risk: "high", name: "Wireshark Packet Sniffer" },
  { pattern: /aircrack|ettercap|metasploit|netcat|ncat|cheat engine|sqlmap|hydra/i, category: "security", risk: "critical", name: "Exploit & Security PenTest Tool" },
  { pattern: /xmrig|nicehash|cgminer|bfgminer|ethminer/i, category: "utility", risk: "critical", name: "Cryptocurrency Miner" },
];

const CATEGORY_RULES = [
  { pattern: /visual studio|code|jetbrains|intellij|pycharm|webstorm|sublime|eclipse|xcode|android studio|git|docker|postman|insomnia|node\.js|python|golang/i, category: "development" },
  { pattern: /microsoft|office|excel|word|powerpoint|outlook|onenote|teams|slack|notion|figma|zoom|google chrome|firefox|microsoft edge|brave|adobe|acrobat/i, category: "productivity" },
  { pattern: /discord|whatsapp|telegram|signal|skype|viber/i, category: "communication" },
  { pattern: /7-zip|winrar|vlc|spotify|notepad\+\+|everything/i, category: "utility" },
  { pattern: /defender|antivirus|crowdstrike|sentinel|malwarebytes|sophos|symantec|kaspersky/i, category: "security" },
];

function analyzeSoftware(name: string, publisher?: string) {
  const target = `${name} ${publisher || ""}`.trim();

  for (const rule of BLACKLIST_RULES) {
    if (rule.pattern.test(target)) {
      return {
        isBlacklisted: true,
        category: rule.category,
        riskLevel: rule.risk,
      };
    }
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(target)) {
      return {
        isBlacklisted: false,
        category: rule.category,
        riskLevel: "safe",
      };
    }
  }

  return {
    isBlacklisted: false,
    category: "utility",
    riskLevel: "low",
  };
}

// ─── POST /api/security/devices/software — Ingest Installed Software ───
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
      software = [],
      orgId: rawOrgId,
      employeeEmail,
      employeeCode,
    } = body;

    if (!deviceHostname) {
      return NextResponse.json(
        { error: "deviceHostname is required" },
        { status: 400 }
      );
    }

    const cleanHostname = deviceHostname.toUpperCase().trim();
    if (cleanHostname !== agent.deviceHostname) {
      return NextResponse.json({ error: "Hostname does not match agent key" }, { status: 403 });
    }

    const database = db();

    // 1. Resolve Device Policy Record
    const device = await database.query.deviceSecurityPolicies.findFirst({
      where: eq(deviceSecurityPolicies.deviceHostname, cleanHostname),
    });

    let resolvedOrgId = agent.orgId || rawOrgId || device?.orgId;
    if (!resolvedOrgId) {
      const org = await database.query.organizations.findFirst({
        columns: { id: true },
      });
      resolvedOrgId = org?.id;
    }

    if (!resolvedOrgId) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    // 2. Resolve Employee
    let employeeId = device?.employeeId || null;
    let employeeName = null;
    let resolvedEmail = employeeEmail || device?.employeeEmail;

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
        employeeName = `${emp.firstName} ${emp.lastName || ""}`.trim();
        resolvedEmail = emp.workEmail;
      }
    }

    // 3. Process & Analyze Installed Software List
    const blacklistedFound: Array<{ name: string; version?: string; publisher?: string; riskLevel: string }> = [];
    let processedCount = 0;

    for (const item of software) {
      if (!item.name || typeof item.name !== "string") continue;
      const cleanName = item.name.trim();
      const cleanVer = item.version ? String(item.version).trim().slice(0, 100) : "1.0.0";
      const cleanPub = item.publisher ? String(item.publisher).trim().slice(0, 255) : null;
      const cleanDate = item.installDate ? String(item.installDate).trim().slice(0, 50) : null;

      const analysis = analyzeSoftware(cleanName, cleanPub || undefined);
      if (analysis.isBlacklisted) {
        blacklistedFound.push({
          name: cleanName,
          version: cleanVer,
          publisher: cleanPub || undefined,
          riskLevel: analysis.riskLevel,
        });
      }

      // Upsert record into deviceInstalledSoftware
      const existing = await database.query.deviceInstalledSoftware.findFirst({
        where: and(
          eq(deviceInstalledSoftware.deviceHostname, cleanHostname),
          eq(deviceInstalledSoftware.name, cleanName),
          eq(deviceInstalledSoftware.version, cleanVer)
        ),
      });

      if (existing) {
        await database
          .update(deviceInstalledSoftware)
          .set({
            isBlacklisted: analysis.isBlacklisted,
            category: analysis.category,
            riskLevel: analysis.riskLevel,
            publisher: cleanPub || existing.publisher,
            installDate: cleanDate || existing.installDate,
            employeeId: employeeId || existing.employeeId,
            deviceId: device?.id || existing.deviceId,
            updatedAt: new Date(),
          })
          .where(eq(deviceInstalledSoftware.id, existing.id));
      } else {
        await database.insert(deviceInstalledSoftware).values({
          orgId: resolvedOrgId,
          deviceId: device?.id || null,
          deviceHostname: cleanHostname,
          employeeId: employeeId || null,
          name: cleanName,
          version: cleanVer,
          publisher: cleanPub,
          installDate: cleanDate,
          isBlacklisted: analysis.isBlacklisted,
          category: analysis.category,
          riskLevel: analysis.riskLevel,
        });
      }
      processedCount++;
    }

    // 4. Update Device Security Policy with Software Scan Timestamp and Compliance Penalty
    if (device) {
      const penalty = blacklistedFound.length * 25;
      const newScore = Math.max(0, (device.complianceScore ?? 100) - penalty);
      const newStatus = blacklistedFound.length > 0 ? "critical_risk" : device.complianceStatus;

      await database
        .update(deviceSecurityPolicies)
        .set({
          lastSoftwareScanAt: new Date(),
          complianceScore: newScore,
          complianceStatus: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(deviceSecurityPolicies.id, device.id));
    }

    // 5. Trigger Security Incident for Blacklisted Applications
    let incidentCreated = null;
    if (blacklistedFound.length > 0) {
      const blacklistedAppNames = blacklistedFound.map((b) => b.name).join(", ");
      const [incident] = await database
        .insert(securityIncidents)
        .values({
          orgId: resolvedOrgId,
          employeeId,
          employeeEmail: resolvedEmail,
          employeeCode: employeeCode || device?.employeeCode || null,
          deviceHostname: cleanHostname,
          deviceSerial: device?.deviceSerial || null,
          incidentType: "blacklisted_software_detected",
          severity: "critical",
          actionTaken: "flagged_for_quarantine",
          metadata: {
            blacklistedApplications: blacklistedFound,
            totalFound: blacklistedFound.length,
            detectedAt: new Date().toISOString(),
          },
          status: "open",
        })
        .returning();

      incidentCreated = incident;

      // Send SOC Email Alert
      try {
        const transporter = nodemailer.createTransport({
          host: "mx.circuvent.com",
          port: 587,
          secure: false,
          auth: {
            user: process.env.IMAP_ADMIN_USER || "imapmaster",
            pass: process.env.IMAP_ADMIN_PASS || "yEHy75nY3gm5SNYHmrLqzmgHMrc3WmyLAk8jrf28",
          },
          tls: { rejectUnauthorized: false },
        });

        const appListHtml = blacklistedFound
          .map((a) => `<li style="color: #ef4444; font-weight: bold;">${a.name} (v${a.version || "N/A"}) - Risk: ${a.riskLevel.toUpperCase()}</li>`)
          .join("");

        await transporter.sendMail({
          from: '"Circuvent Security Alert" <security@circuvent.com>',
          to: "security@circuvent.com, it@circuvent.com, admin@circuvent.com, vema@circuvent.com",
          subject: `🚨 [BLACKLISTED SOFTWARE] Unauthorized Application Detected on ${cleanHostname}`,
          html: `
            <div style="font-family: sans-serif; background: #0f1117; color: #f3f4f6; padding: 24px; border-radius: 8px;">
              <h2 style="color: #ef4444; margin-top: 0;">🚨 Blacklisted Software Alert</h2>
              <p>Circuvent Endpoint Security detected blacklisted / high-risk applications on <strong>${cleanHostname}</strong> (${resolvedEmail || "Unassigned"}).</p>
              <div style="background: #1a1d27; padding: 16px; border-radius: 6px; margin: 16px 0;">
                <ul style="margin: 0; padding-left: 20px;">${appListHtml}</ul>
              </div>
              <p>Review the incident or issue a remote process termination command from the HRMS Security Console.</p>
            </div>
          `,
        });

        await database
          .update(securityIncidents)
          .set({ emailAlertSent: true })
          .where(eq(securityIncidents.id, incident.id));
      } catch (mailErr) {
        console.error("[POST /api/security/devices/software] Mailer warning:", mailErr);
      }
    }

    return NextResponse.json({
      success: true,
      processedCount,
      blacklistedFoundCount: blacklistedFound.length,
      blacklistedApplications: blacklistedFound,
      incident: incidentCreated,
    });
  } catch (error: any) {
    console.error("[POST /api/security/devices/software] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to ingest software inventory" },
      { status: 500 }
    );
  }
}

// ─── GET /api/security/devices/software — Query Fleet Software Inventory ───
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const category = searchParams.get("category");
    const riskLevel = searchParams.get("riskLevel");
    const isBlacklisted = searchParams.get("isBlacklisted");
    const deviceHostname = searchParams.get("deviceHostname");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const database = db();
    const whereConditions: any[] = [];

    if (search) {
      whereConditions.push(
        or(
          ilike(deviceInstalledSoftware.name, `%${search}%`),
          ilike(deviceInstalledSoftware.publisher, `%${search}%`),
          ilike(deviceInstalledSoftware.deviceHostname, `%${search}%`)
        )
      );
    }
    if (category && category !== "all") {
      whereConditions.push(eq(deviceInstalledSoftware.category, category));
    }
    if (riskLevel && riskLevel !== "all") {
      whereConditions.push(eq(deviceInstalledSoftware.riskLevel, riskLevel));
    }
    if (isBlacklisted === "true") {
      whereConditions.push(eq(deviceInstalledSoftware.isBlacklisted, true));
    }
    if (deviceHostname) {
      whereConditions.push(eq(deviceInstalledSoftware.deviceHostname, deviceHostname.toUpperCase()));
    }

    const items = await database
      .select({
        id: deviceInstalledSoftware.id,
        name: deviceInstalledSoftware.name,
        version: deviceInstalledSoftware.version,
        publisher: deviceInstalledSoftware.publisher,
        installDate: deviceInstalledSoftware.installDate,
        isBlacklisted: deviceInstalledSoftware.isBlacklisted,
        category: deviceInstalledSoftware.category,
        riskLevel: deviceInstalledSoftware.riskLevel,
        deviceHostname: deviceInstalledSoftware.deviceHostname,
        deviceId: deviceInstalledSoftware.deviceId,
        employeeId: deviceInstalledSoftware.employeeId,
        updatedAt: deviceInstalledSoftware.updatedAt,
      })
      .from(deviceInstalledSoftware)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(deviceInstalledSoftware.isBlacklisted), desc(deviceInstalledSoftware.updatedAt))
      .limit(limit);

    // Fleet Summary Metrics
    const allSoftware = await database.select().from(deviceInstalledSoftware);
    const uniqueApps = new Set(allSoftware.map((s) => s.name.toLowerCase()));
    const blacklistedCount = allSoftware.filter((s) => s.isBlacklisted).length;
    const highRiskCount = allSoftware.filter((s) => s.riskLevel === "high" || s.riskLevel === "critical").length;
    const saasProductivityCount = allSoftware.filter((s) => s.category === "productivity").length;

    return NextResponse.json({
      software: items,
      summary: {
        totalInstallations: allSoftware.length,
        uniqueApplications: uniqueApps.size,
        blacklistedCount,
        highRiskCount,
        saasProductivityCount,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/security/devices/software] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch software inventory" },
      { status: 500 }
    );
  }
}

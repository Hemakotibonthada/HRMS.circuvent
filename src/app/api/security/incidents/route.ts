import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { securityIncidents, deviceSecurityPolicies } from "@/db/schema/security-incidents";
import { employees } from "@/db/schema/hrms";
import { organizations } from "@/db/schema/identity";
import { eq, desc, and, sql, or } from "drizzle-orm";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/security/incidents — Report a DLP / USB Violation ───
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orgId,
      employeeId: rawEmployeeId,
      employeeCode,
      employeeEmail,
      deviceHostname,
      deviceSerial,
      deviceUsername,
      incidentType = "unauthorized_usb_drive",
      severity = "critical",
      actionTaken = "blocked_and_ejected",
      osVersion,
      metadata = {},
    } = body;

    if (!deviceHostname) {
      return NextResponse.json(
        { error: "deviceHostname is required" },
        { status: 400 }
      );
    }

    const database = db();

    // 1. Resolve Organization ID if not passed
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

    // 2. Resolve Employee details if available
    let employeeId: string | null = rawEmployeeId || null;
    let employeeName: string | null = null;
    let managerEmail: string | null = null;

    if (employeeEmail || employeeCode) {
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
        if (emp.reportingToId) {
          const mgr = await database.query.employees.findFirst({
            where: (e: any, { eq }: any) => eq(e.id, emp.reportingToId),
          });
          if (mgr?.workEmail) {
            managerEmail = mgr.workEmail;
          }
        }
      }
    }

    // 3. Insert Incident Record
    const [incident] = await database
      .insert(securityIncidents)
      .values({
        orgId: resolvedOrgId,
        employeeId,
        employeeCode: employeeCode ? employeeCode.toUpperCase() : null,
        employeeEmail: employeeEmail ? employeeEmail.toLowerCase() : null,
        deviceHostname: deviceHostname.toUpperCase(),
        deviceSerial: deviceSerial || null,
        deviceUsername: deviceUsername || null,
        incidentType,
        severity,
        actionTaken,
        osVersion: osVersion || null,
        metadata,
        status: "open",
        emailAlertSent: false,
      })
      .returning();

    // 4. Send Instant Security & DLP Email Notification
    let emailSent = false;
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

      const driveLetter = metadata.driveLetter || "Removable Disk";
      const volumeName = metadata.volumeName || "External USB";
      const vendor = metadata.vendor || "Generic Storage";
      const model = metadata.model || "";
      const timeStr = new Date().toUTCString();

      const recipients = [
        "security@circuvent.com",
        "it@circuvent.com",
        "admin@circuvent.com",
        "vema@circuvent.com",
      ];
      if (managerEmail && !recipients.includes(managerEmail)) {
        recipients.push(managerEmail);
      }

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0c0e14; color: #f3f4f6; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #161922; border-radius: 12px; border: 1px solid #dc2626; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); padding: 24px; text-align: center; border-bottom: 2px solid #ef4444;">
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
        🚨 CRITICAL DLP ALERT: USB Storage Blocked
      </h1>
      <p style="color: #fecaca; margin: 6px 0 0 0; font-size: 13px;">
        Circuvent Endpoint Security Guard &bull; Immediate Action Required
      </p>
    </div>

    <div style="padding: 24px; font-size: 14px; line-height: 1.6; color: #e5e7eb;">
      <p style="margin-top: 0;">An unauthorized external USB storage device was connected to a corporate laptop and immediately dismounted &amp; neutralized by Circuvent Device Guard.</p>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #1f2430; border-radius: 8px; overflow: hidden;">
        <tbody>
          <tr style="border-bottom: 1px solid #2d3748;">
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600; width: 35%;">Employee:</td>
            <td style="padding: 10px 14px; color: #ffffff; font-weight: bold;">${employeeName || employeeEmail || "Unassigned"} (${employeeCode || "N/A"})</td>
          </tr>
          <tr style="border-bottom: 1px solid #2d3748;">
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600;">Work Email:</td>
            <td style="padding: 10px 14px; color: #60a5fa;">${employeeEmail || "N/A"}</td>
          </tr>
          <tr style="border-bottom: 1px solid #2d3748;">
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600;">Laptop Hostname:</td>
            <td style="padding: 10px 14px; color: #f87171; font-family: monospace; font-weight: bold;">${deviceHostname}</td>
          </tr>
          <tr style="border-bottom: 1px solid #2d3748;">
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600;">Hardware Serial:</td>
            <td style="padding: 10px 14px; color: #ffffff; font-family: monospace;">${deviceSerial || "N/A"}</td>
          </tr>
          <tr style="border-bottom: 1px solid #2d3748;">
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600;">Detected USB Device:</td>
            <td style="padding: 10px 14px; color: #fbbf24; font-weight: 600;">${vendor} ${model} (${volumeName} - ${driveLetter})</td>
          </tr>
          <tr style="border-bottom: 1px solid #2d3748;">
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600;">Action Enforced:</td>
            <td style="padding: 10px 14px; color: #34d399; font-weight: 700;">BLOCKED, EJECTED &amp; REPORTED</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; color: #9ca3af; font-weight: 600;">Timestamp (UTC):</td>
            <td style="padding: 10px 14px; color: #9ca3af;">${timeStr}</td>
          </tr>
        </tbody>
      </table>

      <div style="background: #2a1b1e; border: 1px solid #991b1b; border-radius: 8px; padding: 14px; margin-top: 20px;">
        <p style="margin: 0; color: #fca5a5; font-size: 13px;">
          <strong>Security Policy Reminder:</strong> Under Circuvent Information Security &amp; ISO 27001 DLP policies, connecting unauthorized mass storage media is strictly prohibited. An audit ticket has been logged automatically.
        </p>
      </div>

      <div style="text-align: center; margin-top: 24px;">
        <a href="https://hrms.circuvent.com/security/incidents" style="background-color: #ef4444; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px;">
          Open HRMS Incident Console &rarr;
        </a>
      </div>
    </div>

    <div style="background: #11141c; padding: 14px 24px; text-align: center; border-top: 1px solid #2d3748; color: #6b7280; font-size: 12px;">
      Circuvent Technologies Security Operations Center (SOC) &bull; Automated DLP Alert System
    </div>
  </div>
</body>
</html>
      `;

      await transporter.sendMail({
        from: '"Circuvent Security Alert" <security@circuvent.com>',
        to: recipients.join(", "),
        subject: `🚨 [SECURITY ALERT] Unauthorized USB Drive Blocked on ${deviceHostname} (${employeeEmail || employeeCode || "Staff"})`,
        html,
      });

      emailSent = true;

      // Update incident with emailAlertSent
      await database
        .update(securityIncidents)
        .set({ emailAlertSent: true })
        .where(eq(securityIncidents.id, incident.id));
    } catch (mailErr) {
      console.error("[Security Alert Mailer] Failed to dispatch alert email:", mailErr);
    }

    return NextResponse.json({
      success: true,
      incidentId: incident.id,
      emailAlertSent: emailSent,
      actionTaken: "blocked_and_ejected",
    });
  } catch (error: any) {
    console.error("[POST /api/security/incidents] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to record security incident" },
      { status: 500 }
    );
  }
}

// ─── GET /api/security/incidents — List incidents for Security Dashboard ───
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const severity = searchParams.get("severity");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const database = db();
    const whereConditions: any[] = [];
    if (severity && severity !== "all") {
      whereConditions.push(eq(securityIncidents.severity, severity as any));
    }
    if (status && status !== "all") {
      whereConditions.push(eq(securityIncidents.status, status as any));
    }

    const items = await database
      .select()
      .from(securityIncidents)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(securityIncidents.createdAt))
      .limit(limit);

    // Calculate Summary Stats
    const allIncidents = await database
      .select({
        severity: securityIncidents.severity,
        status: securityIncidents.status,
      })
      .from(securityIncidents);

    const stats = {
      total: allIncidents.length,
      critical: allIncidents.filter((i: any) => i.severity === "critical").length,
      open: allIncidents.filter((i: any) => i.status === "open").length,
      resolved: allIncidents.filter((i: any) => i.status === "resolved").length,
    };

    return NextResponse.json({
      incidents: items,
      stats,
    });
  } catch (error: any) {
    console.error("[GET /api/security/incidents] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch incidents" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/security/incidents — Update Incident Status & Resolution ───
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, resolutionNotes } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "id and status are required" },
        { status: 400 }
      );
    }

    const database = db();
    const [updated] = await database
      .update(securityIncidents)
      .set({
        status,
        resolutionNotes: resolutionNotes || null,
        resolvedAt: status === "resolved" ? new Date() : null,
      })
      .where(eq(securityIncidents.id, id))
      .returning();

    return NextResponse.json({ success: true, incident: updated });
  } catch (error: any) {
    console.error("[PATCH /api/security/incidents] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update incident" },
      { status: 500 }
    );
  }
}

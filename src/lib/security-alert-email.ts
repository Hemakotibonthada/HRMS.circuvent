// ═══════════════════════════════════════════════════════════════
// SECURITY INCIDENT EMAIL ALERT SYSTEM
// ═══════════════════════════════════════════════════════════════
// Sends instant high-priority alert emails when unauthorized USB drives,
// external media, or data exfiltration attempts are blocked on Windows laptops.

import { sendMail } from "@/lib/mailer";

export interface SecurityIncidentAlertPayload {
  id?: string;
  incidentType: string;
  severity: string;
  actionTaken: string;
  deviceHostname: string;
  deviceSerial?: string | null;
  deviceUsername?: string | null;
  employeeEmail?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  managerEmail?: string | null;
  osVersion?: string | null;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export function formatIncidentTypeName(type: string): string {
  switch (type) {
    case "unauthorized_usb_drive":
      return "Unauthorized External USB / Storage Drive Connected";
    case "blocked_file_copy":
      return "Blocked Data Transfer to External Storage";
    case "unauthorized_smtp_attempt":
      return "Unauthorized Outbound Email Relay Attempt";
    case "dlp_repo_exfiltration":
      return "Source Code Repository Exfiltration Attempt";
    case "security_tamper_attempt":
      return "Endpoint Security Policy Tampering Detected";
    default:
      return type.replace(/_/g, " ").toUpperCase();
  }
}

/**
 * Dispatches automated security alert emails to both the Employee and IT Security / Manager.
 */
export async function sendSecurityIncidentAlerts(
  payload: SecurityIncidentAlertPayload
): Promise<{ employeeMailSent: boolean; managerMailSent: boolean }> {
  const incidentTitle = formatIncidentTypeName(payload.incidentType);
  const eventTime = payload.timestamp || new Date().toISOString();
  const meta = payload.metadata || {};

  let employeeMailSent = false;
  let managerMailSent = false;

  // 1. Send Employee Policy Warning Notice
  if (payload.employeeEmail) {
    const empSubject = `[SECURITY NOTICE] External Storage Policy Triggered on ${payload.deviceHostname}`;
    const empHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
          .card { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; }
          .header { background: linear-gradient(135deg, #dc2626, #b91c1c); padding: 24px; text-align: center; }
          .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
          .content { padding: 28px; }
          .warning-badge { display: inline-block; background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 12px; margin-bottom: 16px; }
          .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #0f172a; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
          .details-table td { padding: 12px 16px; border-bottom: 1px solid #1e293b; font-size: 13px; }
          .details-table td.label { color: #94a3b8; width: 35%; font-weight: 500; }
          .details-table td.value { color: #f1f5f9; font-weight: 600; font-family: monospace; }
          .footer { background: #0f172a; padding: 20px 28px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #334155; }
          .note { background: #450a0a; border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-top: 20px; font-size: 13px; color: #fca5a5; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h1>CIRCUVENT TECHNOLOGIES</h1>
            <p style="margin: 4px 0 0 0; color: #fecaca; font-size: 13px;">Enterprise Endpoint Data Loss Prevention</p>
          </div>
          <div class="content">
            <div class="warning-badge">ACTION BLOCKED &amp; LOGGED</div>
            <h2 style="font-size: 18px; color: #ffffff; margin-top: 0;">Security Policy Enforcement Warning</h2>
            <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">
              Hello ${payload.employeeName || "Employee"},<br><br>
              An attempt to attach or copy data to an external storage device was detected and <strong>automatically blocked</strong> on your company laptop in compliance with Circuvent Technologies Information Security and Data Protection Policies.
            </p>

            <table class="details-table">
              <tr>
                <td class="label">Incident Type</td>
                <td class="value">${incidentTitle}</td>
              </tr>
              <tr>
                <td class="label">Device Hostname</td>
                <td class="value">${payload.deviceHostname}</td>
              </tr>
              <tr>
                <td class="label">Action Taken</td>
                <td class="value" style="color: #ef4444;">${payload.actionTaken.toUpperCase()}</td>
              </tr>
              ${meta.driveLetter ? `<tr><td class="label">Drive Letter</td><td class="value">${meta.driveLetter}</td></tr>` : ""}
              ${meta.vendor ? `<tr><td class="label">Detected Device</td><td class="value">${meta.vendor} ${meta.model || ""}</td></tr>` : ""}
              <tr>
                <td class="label">Timestamp</td>
                <td class="value">${new Date(eventTime).toUTCString()}</td>
              </tr>
            </table>

            <div class="note">
              <strong>Important Policy Notice:</strong><br>
              Transferring company source code, client documents, or proprietary data to personal USB drives, smartphones, or personal cloud storage is strictly prohibited under your employment agreement.
            </div>
          </div>
          <div class="footer">
            Circuvent Technologies IT Security &amp; Compliance &bull; Automated DLP Alert
          </div>
        </div>
      </body>
      </html>
    `;

    employeeMailSent = await sendMail({
      to: payload.employeeEmail,
      subject: empSubject,
      html: empHtml,
      text: `Security Warning: ${incidentTitle} was blocked on ${payload.deviceHostname} at ${eventTime}. External storage connections are prohibited.`,
    });
  }

  // 2. Send IT Security & Reporting Manager Incident Report
  const securityAdmins = ["security@circuvent.com", "it@circuvent.com"];
  if (payload.managerEmail && !securityAdmins.includes(payload.managerEmail)) {
    securityAdmins.push(payload.managerEmail);
  }

  const managerSubject = `[CRITICAL SECURITY ALERT] ${incidentTitle} - ${payload.deviceHostname} (${payload.employeeCode || payload.employeeEmail || "Unknown"})`;
  const managerHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; margin: 0; padding: 20px; }
        .card { max-width: 650px; margin: 0 auto; background: #111827; border-radius: 12px; border: 1px solid #374151; overflow: hidden; }
        .header { background: linear-gradient(135deg, #7f1d1d, #991b1b); padding: 24px; }
        .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; }
        .badge-pill { display: inline-block; background: #ef4444; color: #ffffff; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; margin-top: 6px; text-transform: uppercase; }
        .content { padding: 28px; }
        .details-table { width: 100%; border-collapse: collapse; margin: 18px 0; background: #030712; border-radius: 8px; overflow: hidden; border: 1px solid #1f2937; }
        .details-table td { padding: 10px 14px; border-bottom: 1px solid #111827; font-size: 13px; }
        .details-table td.label { color: #9ca3af; width: 35%; font-weight: 500; }
        .details-table td.value { color: #f9fafb; font-weight: 600; font-family: monospace; }
        .action-button { display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; margin-top: 16px; }
        .footer { background: #030712; padding: 18px 28px; text-align: center; font-size: 11px; color: #6b7280; border-top: 1px solid #1f2937; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>SECURITY INCIDENT REPORT</h1>
          <span class="badge-pill">SEVERITY: ${payload.severity.toUpperCase()}</span>
        </div>
        <div class="content">
          <p style="color: #e5e7eb; font-size: 14px; margin-top: 0;">
            A high-severity Data Loss Prevention (DLP) event was captured and neutralized by <strong>CircuventGuard Endpoint Security</strong>.
          </p>

          <table class="details-table">
            <tr>
              <td class="label">Incident ID</td>
              <td class="value">${payload.id || "INC-" + Math.floor(100000 + Math.random() * 900000)}</td>
            </tr>
            <tr>
              <td class="label">Incident Type</td>
              <td class="value" style="color: #f87171;">${incidentTitle}</td>
            </tr>
            <tr>
              <td class="label">Employee</td>
              <td class="value">${payload.employeeName || "N/A"} (${payload.employeeCode || "N/A"})</td>
            </tr>
            <tr>
              <td class="label">Work Email</td>
              <td class="value">${payload.employeeEmail || "N/A"}</td>
            </tr>
            <tr>
              <td class="label">Laptop Hostname</td>
              <td class="value">${payload.deviceHostname}</td>
            </tr>
            <tr>
              <td class="label">BIOS / Hardware Serial</td>
              <td class="value">${payload.deviceSerial || "N/A"}</td>
            </tr>
            <tr>
              <td class="label">Operating System</td>
              <td class="value">${payload.osVersion || "Windows 11 Enterprise"}</td>
            </tr>
            <tr>
              <td class="label">Action Taken</td>
              <td class="value" style="color: #34d399;">${payload.actionTaken.toUpperCase()}</td>
            </tr>
            ${meta.driveLetter ? `<tr><td class="label">Drive Letter</td><td class="value">${meta.driveLetter}</td></tr>` : ""}
            ${meta.vendor ? `<tr><td class="label">Device Hardware</td><td class="value">${meta.vendor} ${meta.model || ""} (${meta.sizeGB || 0} GB)</td></tr>` : ""}
            ${meta.pnpDeviceID ? `<tr><td class="label">PNP Device ID</td><td class="value" style="font-size: 11px; word-break: break-all;">${meta.pnpDeviceID}</td></tr>` : ""}
            <tr>
              <td class="label">Timestamp</td>
              <td class="value">${new Date(eventTime).toUTCString()}</td>
            </tr>
          </table>

          <div style="text-align: center;">
            <a href="https://hrms.circuvent.com/security/incidents" class="action-button">View in Security Console &rarr;</a>
          </div>
        </div>
        <div class="footer">
          Circuvent Technologies Incident Response &bull; Automated Security Telemetry
        </div>
      </div>
    </body>
    </html>
  `;

  managerMailSent = await sendMail({
    to: securityAdmins.join(", "),
    subject: managerSubject,
    html: managerHtml,
    text: `CRITICAL ALERT: ${incidentTitle} detected on ${payload.deviceHostname} for ${payload.employeeEmail || payload.employeeCode}. Action taken: ${payload.actionTaken}.`,
  });

  return { employeeMailSent, managerMailSent };
}

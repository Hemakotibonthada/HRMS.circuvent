// ═══════════════════════════════════════════════════════════════
// CLOCK-OUT REMINDER SERVICE
// ═══════════════════════════════════════════════════════════════
// Detects employees who clocked in today or on their last shift but
// forgot to clock out, and sends an automated reminder to their
// work email prompting them to clock out or submit regularization.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { attendanceRecords, employees, shifts } from "@/db/schema/hrms";
import { sendMail } from "@/lib/mailer";

export interface ClockoutReminderResult {
  checked: number;
  reminded: number;
  recipients: Array<{
    employeeId: string;
    employeeName: string;
    email: string;
    clockInAt: string;
    workDate: string;
  }>;
}

export async function sendClockOutReminders(
  ctx: TenantContext
): Promise<ClockoutReminderResult> {
  return withTenant(ctx, async (tx) => {
    const now = new Date();

    // Query open attendance records (clocked in, no clock out)
    const openRecords = await tx
      .select({
        attendanceId: attendanceRecords.id,
        workDate: attendanceRecords.workDate,
        clockInAt: attendanceRecords.clockInAt,
        clockInMethod: attendanceRecords.clockInMethod,
        employeeId: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        workEmail: employees.workEmail,
        personalEmail: employees.personalEmail,
        shiftStart: shifts.startTime,
        shiftEnd: shifts.endTime,
        isNightShift: shifts.isNightShift,
      })
      .from(attendanceRecords)
      .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
      .leftJoin(shifts, eq(shifts.id, attendanceRecords.shiftId))
      .where(
        and(
          isNull(attendanceRecords.clockOutAt),
          sql`${attendanceRecords.clockInAt} IS NOT NULL`,
          // Records within the last 48 hours
          sql`${attendanceRecords.clockInAt} >= now() - interval '48 hours'`
        )
      )
      .orderBy(desc(attendanceRecords.clockInAt));

    const recipients: ClockoutReminderResult["recipients"] = [];

    for (const record of openRecords) {
      const email = record.workEmail?.trim() || record.personalEmail?.trim();
      if (!email || !record.clockInAt) continue;

      const employeeName = `${record.firstName} ${record.lastName || ""}`.trim();
      const clockInTimeStr = record.clockInAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      });

      const portalUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://hrms.circuvent.com";

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 30px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #7c3aed, #9333ea); padding: 24px 32px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .content { padding: 32px; }
    .badge { display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; color: #c2410c; background-color: #ffedd5; border-radius: 6px; margin-bottom: 16px; }
    .box { background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #7c3aed, #9333ea); color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; margin-top: 20px; }
    .footer { padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Circuvent HRMS · Attendance Alert</h1>
    </div>
    <div class="content">
      <div class="badge">⚠️ Forgotten Clock-Out Detected</div>
      <p>Hello <strong>${employeeName}</strong>,</p>
      <p>Our attendance tracking system noticed that you clocked in today, but <strong>no clock-out punch has been recorded</strong> for your shift.</p>
      
      <div class="box">
        <div style="margin-bottom: 6px;"><strong>Date:</strong> ${record.workDate}</div>
        <div style="margin-bottom: 6px;"><strong>Clock In:</strong> ${clockInTimeStr} (${record.clockInMethod || "Web Portal"})</div>
        <div><strong>Status:</strong> Unclosed Session (marked as 0-1h web punch until resolved)</div>
      </div>

      <p>To ensure your payroll hours, overtime, and work logs are calculated accurately, please clock out now or submit a regularization request if you have already completed your working hours.</p>

      <div style="text-align: center;">
        <a href="${portalUrl}/attendance" class="btn">Clock Out on HRMS Portal &rarr;</a>
      </div>
    </div>
    <div class="footer">
      <p>This is an automated notification from Circuvent HRMS Attendance System.<br>&copy; ${now.getFullYear()} Circuvent Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

      const sent = await sendMail({
        to: email,
        subject: `Attendance Reminder: Forgotten to Clock Out (${record.workDate})`,
        html,
        text: `Hello ${employeeName},\n\nYou clocked in at ${clockInTimeStr} on ${record.workDate}, but no clock-out was recorded.\nPlease log in to ${portalUrl}/attendance to clock out or regularize your hours.\n\nCircuvent HRMS`,
      });

      if (sent) {
        recipients.push({
          employeeId: record.employeeId,
          employeeName,
          email,
          clockInAt: record.clockInAt.toISOString(),
          workDate: String(record.workDate),
        });
      }
    }

    return {
      checked: openRecords.length,
      reminded: recipients.length,
      recipients,
    };
  });
}

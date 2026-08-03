import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  adminDb,
  requireUserOrService,
  authErrorResponse,
} from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// BULK SYNC API
// Syncs all HRMS employees to CV-365 and Mail databases.
// Used for initial migration or periodic full sync.
// ═══════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    await requireUserOrService(req);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const hrmsDb = adminDb("hrms-circuvent");
    const cv365Db = adminDb("cv-365");
    const mailDb = adminDb();

    // Fetch all employees from HRMS
    const empSnap = await hrmsDb.collection("employees").get();
    const total = empSnap.size;
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const empDoc of empSnap.docs) {
      const data = empDoc.data();
      const displayName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || data.email || "Unknown";

      // Sync to CV-365
      try {
        await cv365Db.collection("users").doc(empDoc.id).set({
          uid: empDoc.id,
          displayName,
          email: data.email || "",
          role: "member",
          avatar: "",
          employeeId: empDoc.id,
          jobTitle: data.designation || "",
          department: data.department || "",
          manager: data.reportingManager || "",
          syncedFromHRMS: true,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (err: unknown) {
        errors.push(`CV-365 sync for ${data.email}: ${(err as Error).message}`);
      }

      // Sync to Mail
      try {
        await mailDb.collection("users").doc(empDoc.id).set({
          displayName,
          email: data.email || "",
          role: "user",
          status: "active",
          syncedFromHRMS: true,
          updatedAt: FieldValue.serverTimestamp(),
          settings: {
            theme: "system",
            density: "default",
            readingPane: "right",
            conversationView: true,
            undoSendDelay: 5,
            notificationsEnabled: true,
            notificationSound: true,
            signature: `${displayName}\n${data.designation || ""}\n${data.department || ""}`,
            language: "en",
            timezone: "Asia/Kolkata",
          },
        }, { merge: true });
        synced++;
      } catch (err: unknown) {
        failed++;
        errors.push(`Mail sync for ${data.email}: ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      success: true,
      total,
      synced,
      failed,
      errors: errors.slice(0, 10), // Return first 10 errors only
    });
  } catch (error) {
    console.error("Bulk sync error:", error);
    return NextResponse.json(
      { success: false, error: "Bulk sync failed" },
      { status: 500 }
    );
  }
}

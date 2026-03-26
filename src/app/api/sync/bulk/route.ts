import { NextRequest, NextResponse } from "next/server";
import {
  initializeApp as initClientApp,
  getApps as getClientApps,
} from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// ═══════════════════════════════════════════════════════════════
// BULK SYNC API
// Syncs all HRMS employees to CV-365 and Mail databases.
// Used for initial migration or periodic full sync.
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCh3BRY6Azf3pY3pbeWm0hYe7xs93uj_aA",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "circuvent.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "circuvent",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "circuvent.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "743562898363",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:743562898363:web:dcce791242be3af248b29e",
};

function getDb(dbName?: string) {
  const app = getClientApps().length === 0
    ? initClientApp(firebaseConfig)
    : getClientApps()[0];
  if (!dbName) {
    try { return getFirestore(app); } catch { return getFirestore(app); }
  }
  try {
    return initializeFirestore(app, { experimentalForceLongPolling: true, localCache: memoryLocalCache() }, dbName);
  } catch {
    return getFirestore(app, dbName);
  }
}

export async function POST(req: NextRequest) {
  try {
    const hrmsDb = getDb("hrms-circuvent");
    const cv365Db = getDb("cv-365");
    const mailDb = getDb();

    // Fetch all employees from HRMS
    const empSnap = await getDocs(collection(hrmsDb, "employees"));
    const total = empSnap.size;
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const empDoc of empSnap.docs) {
      const data = empDoc.data();
      const displayName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || data.email || "Unknown";

      // Sync to CV-365
      try {
        await setDoc(doc(cv365Db, "users", empDoc.id), {
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
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err: unknown) {
        errors.push(`CV-365 sync for ${data.email}: ${(err as Error).message}`);
      }

      // Sync to Mail
      try {
        await setDoc(doc(mailDb, "users", empDoc.id), {
          displayName,
          email: data.email || "",
          role: "user",
          status: "active",
          syncedFromHRMS: true,
          updatedAt: serverTimestamp(),
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

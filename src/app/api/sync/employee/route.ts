import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════
// CROSS-APP EMPLOYEE SYNC API
// Allows CV-365 and Mail.circuvent to fetch/validate employee
// data from the HRMS system. Used for login gating and profile sync.
// ═══════════════════════════════════════════════════════════════

import {
  initializeApp as initClientApp,
  getApps as getClientApps,
} from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCh3BRY6Azf3pY3pbeWm0hYe7xs93uj_aA",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "circuvent.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "circuvent",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "circuvent.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "743562898363",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:743562898363:web:dcce791242be3af248b29e",
};

function getHrmsDb() {
  const app = getClientApps().length === 0
    ? initClientApp(firebaseConfig)
    : getClientApps()[0];
  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    }, "hrms-circuvent");
  } catch {
    return getFirestore(app, "hrms-circuvent");
  }
}

// ─── GET: Fetch employee by email or uid ─────────────────────
// Usage: GET /api/sync/employee?email=user@company.com
//    or: GET /api/sync/employee?uid=abc123

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");
    const uid = searchParams.get("uid");

    if (!email && !uid) {
      return NextResponse.json(
        { success: false, error: "Provide 'email' or 'uid' query parameter" },
        { status: 400 }
      );
    }

    const db = getHrmsDb();

    if (uid) {
      const snap = await getDoc(doc(db, "employees", uid));
      if (!snap.exists()) {
        return NextResponse.json(
          { success: false, error: "Employee not found" },
          { status: 404 }
        );
      }
      const data = snap.data();
      return NextResponse.json({
        success: true,
        employee: {
          id: snap.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          department: data.department,
          designation: data.designation,
          joiningDate: data.joiningDate,
          status: data.status,
          employmentType: data.employmentType,
          location: data.location,
          reportingManager: data.reportingManager,
        },
      });
    }

    // Search by email
    const q = query(collection(db, "employees"), where("email", "==", email));
    const snap = await getDocs(q);

    if (snap.empty) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    const empDoc = snap.docs[0];
    const data = empDoc.data();

    return NextResponse.json({
      success: true,
      employee: {
        id: empDoc.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        department: data.department,
        designation: data.designation,
        joiningDate: data.joiningDate,
        status: data.status,
        employmentType: data.employmentType,
        location: data.location,
        reportingManager: data.reportingManager,
      },
    });
  } catch (error) {
    console.error("Employee fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

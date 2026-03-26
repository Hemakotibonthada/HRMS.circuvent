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
  query,
  where,
  getDocs,
} from "firebase/firestore";

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE VALIDATION API
// Called by CV-365 during login to verify the user is an active
// employee in the HRMS system before allowing access.
// ═══════════════════════════════════════════════════════════════

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

// ─── POST: Validate employee by email ────────────────────────
// Body: { "email": "user@company.com" }
// Returns: { valid: true, employee: {...} } or { valid: false }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body?.email;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { valid: false, error: "Email is required" },
        { status: 400 }
      );
    }

    const db = getHrmsDb();
    const q = query(
      collection(db, "employees"),
      where("email", "==", email.toLowerCase().trim())
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      return NextResponse.json({
        valid: false,
        error: "No employee record found for this email",
      });
    }

    const empDoc = snap.docs[0];
    const data = empDoc.data();

    // Check if the employee is active
    const activeStatuses = ["active", "probation"];
    const isActive = activeStatuses.includes(data.status || "");

    if (!isActive) {
      return NextResponse.json({
        valid: false,
        error: `Employee account is ${data.status || "inactive"}. Contact HR.`,
        status: data.status,
      });
    }

    return NextResponse.json({
      valid: true,
      employee: {
        id: empDoc.id,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
        email: data.email,
        department: data.department,
        designation: data.designation,
        joiningDate: data.joiningDate,
        status: data.status,
        location: data.location,
        reportingManager: data.reportingManager,
      },
    });
  } catch (error) {
    console.error("Employee validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation service unavailable" },
      { status: 500 }
    );
  }
}

// ─── GET: Quick validation check ─────────────────────────────
// Usage: GET /api/auth/validate-employee?email=user@company.com

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json(
        { valid: false, error: "Email query parameter required" },
        { status: 400 }
      );
    }

    const db = getHrmsDb();
    const q = query(
      collection(db, "employees"),
      where("email", "==", email.toLowerCase().trim())
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      return NextResponse.json({ valid: false });
    }

    const data = snap.docs[0].data();
    const activeStatuses = ["active", "probation"];

    return NextResponse.json({
      valid: activeStatuses.includes(data.status || ""),
      status: data.status,
      department: data.department,
      designation: data.designation,
    });
  } catch {
    return NextResponse.json(
      { valid: false, error: "Service unavailable" },
      { status: 500 }
    );
  }
}

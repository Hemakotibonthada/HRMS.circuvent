// ═══════════════════════════════════════════════════════════════
// CROSS-APP USER SYNC SERVICE
// Syncs employee data across HRMS, CV-365, and Mail.circuvent
// All apps use the same Firebase project (circuvent) with
// different named Firestore databases
// ═══════════════════════════════════════════════════════════════

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import { requireFirebaseEnv } from "./firebase-env";

// ─── Firebase App (shared — same project) ────────────────────

const firebaseConfig = {
  apiKey: requireFirebaseEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
  authDomain: requireFirebaseEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: requireFirebaseEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: requireFirebaseEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
};

function getOrCreateApp() {
  return getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
}

// ─── Database References ─────────────────────────────────────

// Cache DB instances to avoid re-initialization errors
const dbCache: Record<string, Firestore> = {};

function getNamedDb(dbName: string): Firestore {
  if (dbCache[dbName]) return dbCache[dbName];
  const app = getOrCreateApp();
  try {
    const db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    }, dbName);
    dbCache[dbName] = db;
    return db;
  } catch {
    const db = getFirestore(app, dbName);
    dbCache[dbName] = db;
    return db;
  }
}

function getDefaultDb(): Firestore {
  if (dbCache["(default)"]) return dbCache["(default)"];
  const app = getOrCreateApp();
  try {
    const db = getFirestore(app);
    dbCache["(default)"] = db;
    return db;
  } catch {
    const db = getFirestore(app);
    dbCache["(default)"] = db;
    return db;
  }
}

/** HRMS database — named "hrms-circuvent" */
export function getHrmsDb(): Firestore {
  return getNamedDb("hrms-circuvent");
}

/** CV-365 database — named "cv-365" */
export function getCv365Db(): Firestore {
  return getNamedDb("cv-365");
}

/** Mail database — default (no name) */
export function getMailDb(): Firestore {
  return getDefaultDb();
}

// ─── Types ───────────────────────────────────────────────────

export interface CrossAppEmployee {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  phone?: string;
  department: string;
  designation: string;
  joiningDate: string;
  status: string;
  employmentType: string;
  location?: string;
  reportingManager?: string;
  role: "admin" | "hr" | "employee";
}

export interface SyncResult {
  success: boolean;
  firebaseAuthCreated: boolean;
  hrmsUserCreated: boolean;
  cv365UserCreated: boolean;
  mailUserCreated: boolean;
  errors: string[];
}

// ─── Create Employee Across All Apps ─────────────────────────

/**
 * Creates a new employee account across all three applications:
 * 1. Creates Firebase Auth account (shared across all apps)
 * 2. Creates user doc in HRMS Firestore (hrms-circuvent DB)
 * 3. Creates user doc in CV-365 Firestore (cv-365 DB)
 * 4. Creates user doc in Mail Firestore (default DB)
 */
export async function createEmployeeAcrossApps(
  employee: CrossAppEmployee,
  password: string
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    firebaseAuthCreated: false,
    hrmsUserCreated: false,
    cv365UserCreated: false,
    mailUserCreated: false,
    errors: [],
  };

  const auth = getAuth(getOrCreateApp());

  // Step 1: Create Firebase Auth account
  let uid = employee.uid;
  try {
    const cred = await createUserWithEmailAndPassword(auth, employee.email, password);
    uid = cred.user.uid;
    await updateProfile(cred.user, { displayName: employee.displayName });
    result.firebaseAuthCreated = true;
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === "auth/email-already-in-use") {
      // User already exists in Auth — that's fine, we'll sync the docs
      result.firebaseAuthCreated = true;
      // Try to find existing UID
      result.errors.push("Auth account already exists — syncing docs only");
    } else {
      result.errors.push(`Firebase Auth error: ${error.message || "Unknown error"}`);
      return result;
    }
  }

  // Step 2: Write to HRMS database (hrms-circuvent)
  try {
    const hrmsDb = getHrmsDb();

    // Write to "users" collection (for RBAC role lookup)
    await setDoc(doc(hrmsDb, "users", uid), {
      uid,
      email: employee.email,
      displayName: employee.displayName,
      role: employee.role,
      department: employee.department,
      designation: employee.designation,
      status: employee.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    // Write/update the "employees" collection
    await setDoc(doc(hrmsDb, "employees", uid), {
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone || "",
      department: employee.department,
      designation: employee.designation,
      joiningDate: employee.joiningDate,
      status: employee.status,
      employmentType: employee.employmentType,
      location: employee.location || "",
      reportingManager: employee.reportingManager || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    result.hrmsUserCreated = true;
  } catch (err: unknown) {
    result.errors.push(`HRMS sync error: ${(err as Error).message}`);
  }

  // Step 3: Write to CV-365 database (cv-365)
  try {
    const cv365Db = getCv365Db();
    await setDoc(doc(cv365Db, "users", uid), {
      uid,
      displayName: employee.displayName,
      email: employee.email,
      role: employee.role === "admin" ? "admin" : "member",
      avatar: "",
      employeeId: uid,
      jobTitle: employee.designation,
      department: employee.department,
      officeRole: employee.designation,
      manager: employee.reportingManager || "",
      syncedFromOffice: false,
      syncedFromHRMS: true,
      createdAt: serverTimestamp(),
    }, { merge: true });

    result.cv365UserCreated = true;
  } catch (err: unknown) {
    result.errors.push(`CV-365 sync error: ${(err as Error).message}`);
  }

  // Step 4: Write to Mail database (default)
  try {
    const mailDb = getMailDb();
    await setDoc(doc(mailDb, "users", uid), {
      displayName: employee.displayName,
      email: employee.email,
      role: "user",
      status: "active", // Auto-activate for HRMS-created employees
      createdAt: serverTimestamp(),
      syncedFromHRMS: true,
      settings: {
        theme: "system",
        density: "default",
        readingPane: "right",
        conversationView: true,
        undoSendDelay: 5,
        notificationsEnabled: true,
        notificationSound: true,
        signature: `${employee.displayName}\n${employee.designation}\n${employee.department}`,
        language: "en",
        timezone: "Asia/Kolkata",
      },
    }, { merge: true });

    // Create default labels for the mail user
    const labelsCol = collection(mailDb, "users", uid, "labels");
    const defaultLabels = ["Work", "Personal", "Finance", "Important"];
    for (const label of defaultLabels) {
      await setDoc(doc(labelsCol, label.toLowerCase()), {
        name: label,
        color: label === "Work" ? "#3b82f6" : label === "Personal" ? "#10b981" : label === "Finance" ? "#f59e0b" : "#ef4444",
        createdAt: serverTimestamp(),
      });
    }

    result.mailUserCreated = true;
  } catch (err: unknown) {
    result.errors.push(`Mail sync error: ${(err as Error).message}`);
  }

  result.success = result.hrmsUserCreated && result.cv365UserCreated && result.mailUserCreated;
  return result;
}

// ─── Sync Existing Employee to Other Apps ────────────────────

/**
 * Syncs an existing HRMS employee record to CV-365 and Mail databases.
 * Does NOT create Firebase Auth — assumes account already exists.
 */
export async function syncEmployeeToOtherApps(
  employee: CrossAppEmployee
): Promise<{ cv365: boolean; mail: boolean; errors: string[] }> {
  const errors: string[] = [];
  let cv365 = false;
  let mail = false;

  // Sync to CV-365
  try {
    const cv365Db = getCv365Db();
    await setDoc(doc(cv365Db, "users", employee.uid), {
      displayName: employee.displayName,
      email: employee.email,
      jobTitle: employee.designation,
      department: employee.department,
      manager: employee.reportingManager || "",
      syncedFromHRMS: true,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    cv365 = true;
  } catch (err: unknown) {
    errors.push(`CV-365 sync: ${(err as Error).message}`);
  }

  // Sync to Mail
  try {
    const mailDb = getMailDb();
    await setDoc(doc(mailDb, "users", employee.uid), {
      displayName: employee.displayName,
      email: employee.email,
      syncedFromHRMS: true,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    mail = true;
  } catch (err: unknown) {
    errors.push(`Mail sync: ${(err as Error).message}`);
  }

  return { cv365, mail, errors };
}

// ─── Fetch User Info from CV-365 ─────────────────────────────

/**
 * Fetches a user's profile from CV-365 database by UID or email.
 */
export async function fetchUserFromCv365(
  identifier: { uid?: string; email?: string }
): Promise<Record<string, unknown> | null> {
  try {
    const cv365Db = getCv365Db();

    if (identifier.uid) {
      const snap = await getDoc(doc(cv365Db, "users", identifier.uid));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    if (identifier.email) {
      const q = query(collection(cv365Db, "users"), where("email", "==", identifier.email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Fetch User Info from Mail ───────────────────────────────

/**
 * Fetches a user's profile from Mail database by UID or email.
 */
export async function fetchUserFromMail(
  identifier: { uid?: string; email?: string }
): Promise<Record<string, unknown> | null> {
  try {
    const mailDb = getMailDb();

    if (identifier.uid) {
      const snap = await getDoc(doc(mailDb, "users", identifier.uid));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    if (identifier.email) {
      const q = query(collection(mailDb, "users"), where("email", "==", identifier.email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Fetch User Info from HRMS ───────────────────────────────

/**
 * Fetches an employee's full profile from HRMS database.
 */
export async function fetchEmployeeFromHrms(
  identifier: { uid?: string; email?: string }
): Promise<Record<string, unknown> | null> {
  try {
    const hrmsDb = getHrmsDb();

    if (identifier.uid) {
      const snap = await getDoc(doc(hrmsDb, "employees", identifier.uid));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    if (identifier.email) {
      const q = query(collection(hrmsDb, "employees"), where("email", "==", identifier.email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Sync All Existing Employees ─────────────────────────────

/**
 * Bulk sync: reads all employees from HRMS and writes user docs
 * to CV-365 and Mail databases. Used for initial data migration.
 */
export async function bulkSyncAllEmployees(): Promise<{
  total: number;
  synced: number;
  failed: number;
  errors: string[];
}> {
  const hrmsDb = getHrmsDb();
  const errors: string[] = [];
  let synced = 0;
  let failed = 0;

  try {
    const snap = await getDocs(collection(hrmsDb, "employees"));
    const total = snap.size;

    for (const employee of snap.docs) {
      const data = employee.data();
      try {
        await syncEmployeeToOtherApps({
          uid: employee.id,
          email: data.email || "",
          displayName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          phone: data.phone,
          department: data.department || "",
          designation: data.designation || "",
          joiningDate: data.joiningDate || "",
          status: data.status || "active",
          employmentType: data.employmentType || "Full-time",
          location: data.location,
          reportingManager: data.reportingManager,
          role: "employee",
        });
        synced++;
      } catch (err: unknown) {
        failed++;
        errors.push(`${data.email}: ${(err as Error).message}`);
      }
    }

    return { total, synced, failed, errors };
  } catch (err: unknown) {
    return { total: 0, synced: 0, failed: 0, errors: [`Bulk sync failed: ${(err as Error).message}`] };
  }
}

// ─── Check if User Exists Across Apps ────────────────────────

export async function checkUserExistsAcrossApps(email: string): Promise<{
  hrms: boolean;
  cv365: boolean;
  mail: boolean;
}> {
  const [hrms, cv365, mail] = await Promise.all([
    fetchEmployeeFromHrms({ email }),
    fetchUserFromCv365({ email }),
    fetchUserFromMail({ email }),
  ]);

  return {
    hrms: !!hrms,
    cv365: !!cv365,
    mail: !!mail,
  };
}

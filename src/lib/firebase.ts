import { initializeApp, getApps } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  connectFirestoreEmulator,
  memoryLocalCache,
  collection,
  collectionGroup,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot as _onSnapshot,
  serverTimestamp,
  increment,
  type Timestamp,
  type DocumentData,
  type QueryConstraint,
  arrayUnion,
  arrayRemove,
  writeBatch,
  deleteField,
  Timestamp as TimestampValue,
} from "firebase/firestore";
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  uploadBytesResumable,
} from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCh3BRY6Azf3pY3pbeWm0hYe7xs93uj_aA",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "circuvent.firebaseapp.com",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://circuvent-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "circuvent",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "circuvent.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "743562898363",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:743562898363:web:dcce791242be3af248b29e",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-39GJ3W5T77",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

const auth = getAuth(app);

const globalForFirebase = globalThis as unknown as {
  _firestoreDb?: ReturnType<typeof getFirestore>;
  _fsDevPatched?: boolean;
  _emulatorsConnected?: boolean;
};

let db: ReturnType<typeof getFirestore>;
if (globalForFirebase._firestoreDb) {
  db = globalForFirebase._firestoreDb;
} else {
  try {
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    }, "hrms-circuvent");
  } catch {
    db = getFirestore(app, "hrms-circuvent");
  }
  globalForFirebase._firestoreDb = db;
}

if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && !globalForFirebase._fsDevPatched) {
  globalForFirebase._fsDevPatched = true;
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const stringified = args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.message;
        return "";
      })
      .join(" ");
    if (stringified.includes("INTERNAL ASSERTION FAILED") || stringified.includes("INTERNAL UNHANDLED ERROR")) {
      return;
    }
    origConsoleError.apply(console, args);
  };
  window.addEventListener("unhandledrejection", (event) => {
    const msg = event?.reason?.message || String(event?.reason || "");
    if (msg.includes("INTERNAL ASSERTION FAILED") || msg.includes("INTERNAL UNHANDLED ERROR")) {
      event.preventDefault();
    }
  });
  window.addEventListener("error", (event) => {
    const msg = event?.message || event?.error?.message || "";
    if (msg.includes("INTERNAL ASSERTION FAILED") || msg.includes("INTERNAL UNHANDLED ERROR")) {
      event.preventDefault();
    }
  });
}

const onSnapshot = _onSnapshot;
const storage = getStorage(app);

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !globalForFirebase._emulatorsConnected) {
  globalForFirebase._emulatorsConnected = true;
  connectAuthEmulator(auth, "http://localhost:9098", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8086);
  connectStorageEmulator(storage, "localhost", 9198);
}

const isConfigured = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== "undefined" && isConfigured) {
  isSupported().then((supported) => {
    if (supported) {
      try { analytics = getAnalytics(app); } catch { /* skip */ }
    }
  });
}

export {
  app, auth, db, storage, analytics,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, firebaseSignOut,
  sendPasswordResetEmail, updateProfile, onAuthStateChanged, type User,
  collection, collectionGroup, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, increment,
  arrayUnion, arrayRemove, writeBatch, deleteField, TimestampValue,
  type Timestamp, type DocumentData, type QueryConstraint,
  ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable,
};

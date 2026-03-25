// ═══════════════════════════════════════════════════════════════
// FIRESTORE DATA SERVICE
// Real-time CRUD operations for all HRMS collections
// ═══════════════════════════════════════════════════════════════

import {
  db, collection, doc, setDoc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, increment, writeBatch,
  type DocumentData, type QueryConstraint,
} from "@/lib/firebase";

// ─── Generic CRUD ────────────────────────────────────────────

export async function createDocument<T extends Record<string, unknown>>(
  collectionName: string, data: T
): Promise<string> {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setDocument<T extends Record<string, unknown>>(
  collectionName: string, docId: string, data: T
): Promise<void> {
  await setDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getDocument<T>(
  collectionName: string, docId: string
): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(doc(db, collectionName, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as T & { id: string };
}

export async function getCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<(T & { id: string })[]> {
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T & { id: string }));
}

export async function updateDocument(
  collectionName: string, docId: string, data: Record<string, unknown>
): Promise<void> {
  await updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDocument(
  collectionName: string, docId: string
): Promise<void> {
  await deleteDoc(doc(db, collectionName, docId));
}

export function subscribeToCollection<T>(
  collectionName: string,
  callback: (items: (T & { id: string })[]) => void,
  constraints: QueryConstraint[] = []
): () => void {
  const q = query(collection(db, collectionName), ...constraints);
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as T & { id: string }));
    callback(items);
  }, (error) => {
    console.error(`Firestore subscription error (${collectionName}):`, error);
  });
}

export function subscribeToDocument<T>(
  collectionName: string,
  docId: string,
  callback: (item: (T & { id: string }) | null) => void
): () => void {
  return onSnapshot(doc(db, collectionName, docId), (snap) => {
    if (!snap.exists()) { callback(null); return; }
    callback({ id: snap.id, ...snap.data() } as T & { id: string });
  });
}

// ─── Collection Names ────────────────────────────────────────

export const COLLECTIONS = {
  employees: "employees",
  departments: "departments",
  leaves: "leaves",
  leaveBalances: "leaveBalances",
  attendance: "attendance",
  payroll: "payroll",
  expenses: "expenses",
  announcements: "announcements",
  recruitment: "recruitment",
  candidates: "candidates",
  performance: "performanceReviews",
  goals: "goals",
  training: "training",
  enrollments: "enrollments",
  helpdesk: "helpdesk",
  assets: "assets",
  documents: "documents",
  notifications: "notifications",
  teams: "teams",
  workflows: "workflows",
  surveys: "surveys",
  feedback: "feedback",
  kudos: "kudos",
  events: "events",
  holidays: "holidays",
  policies: "policies",
  loans: "loans",
  travel: "travel",
  wfh: "wfh",
  overtime: "overtime",
  timesheets: "timesheets",
  meetings: "meetingBookings",
  visitors: "visitors",
  referrals: "referrals",
  incidents: "incidents",
  celebrations: "celebrations",
  auditLog: "auditLog",
  settings: "settings",
  shifts: "shifts",
  awards: "awards",
  knowledgebase: "knowledgebase",
  grievances: "grievances",
  wellness: "wellness",
  badges: "badges",
} as const;

// ─── Typed Module APIs ───────────────────────────────────────

export const employeeService = {
  getAll: (orgConstraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.employees, orgConstraints),
  getById: (id: string) => getDocument(COLLECTIONS.employees, id),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.employees, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.employees, id, data),
  remove: (id: string) => deleteDocument(COLLECTIONS.employees, id),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.employees, cb, constraints),
};

export const leaveService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.leaves, constraints),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.leaves, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.leaves, id, data),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.leaves, cb, constraints),
  getBalance: (employeeId: string) => getDocument(COLLECTIONS.leaveBalances, employeeId),
  setBalance: (employeeId: string, data: Record<string, unknown>) =>
    setDocument(COLLECTIONS.leaveBalances, employeeId, data),
};

export const attendanceService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.attendance, constraints),
  clockIn: (data: Record<string, unknown>) => createDocument(COLLECTIONS.attendance, data),
  clockOut: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.attendance, id, data),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.attendance, cb, constraints),
};

export const expenseService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.expenses, constraints),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.expenses, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.expenses, id, data),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.expenses, cb, constraints),
};

export const payrollService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.payroll, constraints),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.payroll, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.payroll, id, data),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.payroll, cb, constraints),
};

export const recruitmentService = {
  getJobs: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.recruitment, constraints),
  createJob: (data: Record<string, unknown>) => createDocument(COLLECTIONS.recruitment, data),
  updateJob: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.recruitment, id, data),
  getCandidates: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.candidates, constraints),
  addCandidate: (data: Record<string, unknown>) => createDocument(COLLECTIONS.candidates, data),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.recruitment, cb, constraints),
};

export const helpdeskService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.helpdesk, constraints),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.helpdesk, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.helpdesk, id, data),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.helpdesk, cb, constraints),
};

export const announcementService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.announcements, constraints),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.announcements, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(COLLECTIONS.announcements, id, data),
  remove: (id: string) => deleteDocument(COLLECTIONS.announcements, id),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.announcements, cb, constraints),
};

export const notificationService = {
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(COLLECTIONS.notifications, constraints),
  create: (data: Record<string, unknown>) => createDocument(COLLECTIONS.notifications, data),
  markRead: (id: string) => updateDocument(COLLECTIONS.notifications, id, { read: true }),
  markAllRead: async (userId: string) => {
    const items = await getCollection(COLLECTIONS.notifications, [
      where("recipientId", "==", userId), where("read", "==", false)
    ]);
    const batch = writeBatch(db);
    items.forEach((item: { id: string }) => {
      batch.update(doc(db, COLLECTIONS.notifications, item.id), { read: true });
    });
    await batch.commit();
  },
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(COLLECTIONS.notifications, cb, constraints),
};

export const genericService = (collectionName: string) => ({
  getAll: (constraints?: QueryConstraint[]) =>
    getCollection(collectionName, constraints),
  getById: (id: string) => getDocument(collectionName, id),
  create: (data: Record<string, unknown>) => createDocument(collectionName, data),
  update: (id: string, data: Record<string, unknown>) => updateDocument(collectionName, id, data),
  remove: (id: string) => deleteDocument(collectionName, id),
  subscribe: (cb: (items: DocumentData[]) => void, constraints?: QueryConstraint[]) =>
    subscribeToCollection(collectionName, cb, constraints),
});

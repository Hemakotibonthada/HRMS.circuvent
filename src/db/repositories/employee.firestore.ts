// ═══════════════════════════════════════════════════════════════
// EMPLOYEE REPOSITORY — Firestore implementation
// ═══════════════════════════════════════════════════════════════
// Wraps the existing behaviour in src/lib/firestore-service.ts without
// changing it, so the migration to Neon is reversible at any point by flipping
// DATA_BACKEND. This is the "before" side of the strangler seam.

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type QueryConstraint,
} from "@/lib/firebase";
import { getOrgId, orgConstraint, withOrgId } from "@/lib/tenant";
import {
  NotFoundError,
  RepositoryError,
  type EmployeeCreate,
  type EmployeeRecord,
  type EmployeeRepository,
  type EmployeeUpdate,
  type ListQuery,
  type Page,
  type Unsubscribe,
} from "./types";

const COLLECTION = "employees";

function toRecord(id: string, data: DocumentData): EmployeeRecord {
  const firstName = (data.firstName as string) ?? "";
  const lastName = (data.lastName as string) ?? "";
  return {
    id,
    employeeCode: (data.employeeId as string) ?? id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email: (data.email as string) ?? "",
    phone: data.phone as string | undefined,
    avatarUrl: data.avatar as string | undefined,
    departmentId: data.departmentId as string | undefined,
    departmentName: data.departmentName as string | undefined,
    designation: (data.designation as string) ?? "",
    reportingToId: data.reportingTo as string | undefined,
    reportingToName: data.reportingToName as string | undefined,
    employmentType: (data.employmentType as string) ?? "full_time",
    status: (data.status as string) ?? "active",
    joinDate: (data.joinDate as string) ?? (data.joiningDate as string) ?? "",
    exitDate: data.exitDate as string | undefined,
    location: data.location as string | undefined,
    salary: data.salary as number | undefined,
    currency: (data.currency as string) ?? "INR",
    organizationId: (data.organizationId as string) ?? "",
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
  };
}

/**
 * Firestore cannot filter on a substring, sort on an arbitrary field and
 * paginate in one query without a composite index per combination. The
 * existing app already reads the whole tenant collection and filters in
 * memory, so that behaviour is preserved here rather than silently changing
 * result sets mid-migration. The Neon implementation does this properly in
 * SQL.
 */
function applyQueryInMemory(items: EmployeeRecord[], q: ListQuery = {}): Page<EmployeeRecord> {
  let result = items;

  if (q.search?.trim()) {
    const needle = q.search.trim().toLowerCase();
    result = result.filter(
      (e) =>
        e.fullName.toLowerCase().includes(needle) ||
        e.email.toLowerCase().includes(needle) ||
        e.designation.toLowerCase().includes(needle) ||
        e.employeeCode.toLowerCase().includes(needle)
    );
  }

  for (const [field, value] of Object.entries(q.filters ?? {})) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    result = result.filter((e) => (e as unknown as Record<string, unknown>)[field] === value);
  }

  const sortBy = q.sortBy ?? "fullName";
  const dir = q.sortDirection === "desc" ? -1 : 1;
  result = [...result].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortBy];
    const bv = (b as unknown as Record<string, unknown>)[sortBy];
    if (av === bv) return 0;
    return (String(av ?? "") > String(bv ?? "") ? 1 : -1) * dir;
  });

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.max(1, q.pageSize ?? 50);
  const start = (page - 1) * pageSize;
  const slice = result.slice(start, start + pageSize);

  return {
    items: slice,
    total: result.length,
    page,
    pageSize,
    hasMore: start + slice.length < result.length,
  };
}

function tenantConstraints(extra: QueryConstraint[] = []): QueryConstraint[] {
  // An unscoped read would either be rejected by the Firestore rules or, worse,
  // return another tenant's employees. Refuse rather than guess.
  if (!getOrgId()) {
    throw new RepositoryError("Organization is not resolved yet; refusing to query", 409);
  }
  return [...orgConstraint(), ...extra];
}

export class FirestoreEmployeeRepository implements EmployeeRepository {
  async list(q: ListQuery = {}): Promise<Page<EmployeeRecord>> {
    const snap = await getDocs(query(collection(db, COLLECTION), ...tenantConstraints()));
    return applyQueryInMemory(
      snap.docs.map((d) => toRecord(d.id, d.data())),
      q
    );
  }

  async getById(id: string): Promise<EmployeeRecord | null> {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    const record = toRecord(snap.id, snap.data());
    // Reading a document by id bypasses the collection query filter, so the
    // tenant has to be checked explicitly here.
    if (record.organizationId && record.organizationId !== getOrgId()) return null;
    return record;
  }

  async create(data: EmployeeCreate): Promise<EmployeeRecord> {
    const payload = withOrgId({
      ...data,
      employeeId: data.employeeCode ?? "",
      reportingTo: data.reportingToId ?? "",
      employmentType: data.employmentType ?? "full_time",
      status: data.status ?? "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const ref = await addDoc(collection(db, COLLECTION), payload);
    const created = await this.getById(ref.id);
    if (!created) throw new RepositoryError("Employee was created but could not be read back");
    return created;
  }

  async update(id: string, data: EmployeeUpdate): Promise<EmployeeRecord> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError("Employee", id);

    await updateDoc(doc(db, COLLECTION, id), {
      ...data,
      ...(data.reportingToId !== undefined ? { reportingTo: data.reportingToId } : {}),
      updatedAt: serverTimestamp(),
    });

    const updated = await this.getById(id);
    if (!updated) throw new NotFoundError("Employee", id);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError("Employee", id);
    await deleteDoc(doc(db, COLLECTION, id));
  }

  subscribe(onChange: (items: EmployeeRecord[]) => void, q: ListQuery = {}): Unsubscribe {
    return onSnapshot(
      query(collection(db, COLLECTION), ...tenantConstraints()),
      (snap) => {
        const records = snap.docs.map((d) => toRecord(d.id, d.data()));
        onChange(applyQueryInMemory(records, q).items);
      },
      (error) => {
        // The original subscribeToCollection swallowed these into console.error
        // and left the UI showing a permanently empty list.
        console.error("Employee subscription failed:", error);
      }
    );
  }

  async listDirectReports(managerId: string): Promise<EmployeeRecord[]> {
    const all = await this.list({ pageSize: 10_000 });
    return all.items.filter((e) => e.reportingToId === managerId);
  }

  async countByStatus(): Promise<Record<string, number>> {
    const all = await this.list({ pageSize: 10_000 });
    return all.items.reduce<Record<string, number>>((acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    }, {});
  }
}

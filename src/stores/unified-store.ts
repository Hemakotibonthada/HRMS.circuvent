import { create } from "zustand";
import {
  employeeService, leaveService, attendanceService, expenseService,
  payrollService, recruitmentService, helpdeskService, announcementService,
  genericService, COLLECTIONS,
} from "@/lib/firestore-service";

// ═══════════════════════════════════════════════════════════════
// UNIFIED REAL-TIME STORES
// Zustand stores backed by Firestore with subscriptions,
// optimistic updates, loading states, and error handling
// ═══════════════════════════════════════════════════════════════

// ─── Generic Store Factory ───────────────────────────────────

export interface BaseRecord { id: string; [key: string]: unknown; }

export interface DataStore<T extends BaseRecord> {
  items: T[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  setItems: (items: T[]) => void;
  addItem: (item: T) => void;
  updateItem: (id: string, updates: Partial<T>) => void;
  removeItem: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInitialized: (v: boolean) => void;
}

function createDataStore<T extends BaseRecord>() {
  return create<DataStore<T>>((set) => ({
    items: [],
    loading: false,
    error: null,
    initialized: false,
    setItems: (items) => set({ items, loading: false, initialized: true }),
    addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
    updateItem: (id, updates) =>
      set((s) => ({
        items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
      })),
    removeItem: (id) =>
      set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    setInitialized: (initialized) => set({ initialized }),
  }));
}

// ─── Store Instances ─────────────────────────────────────────

// Employees
export interface EmployeeDoc extends BaseRecord {
  firstName: string; lastName: string; email: string; phone: string;
  department: string; designation: string; joiningDate: string;
  status: string; employmentType: string; reportingManager: string;
  location: string; salary?: number; skills?: string[];
  gender?: string; dateOfBirth?: string; bloodGroup?: string;
  maritalStatus?: string; nationality?: string;
  emergencyContactName?: string; emergencyContactPhone?: string;
  bankName?: string; bankAccount?: string; ifscCode?: string;
  panNumber?: string; aadharNumber?: string;
  probationEndDate?: string; noticePeriod?: number;
  lastPromotionDate?: string; previousDesignation?: string;
}
export const useEmployeeStore = createDataStore<EmployeeDoc>();

// Departments
export interface DepartmentDoc extends BaseRecord {
  name: string; code: string; head: string; headEmail: string;
  description: string; location: string; budget: number;
  employees: number; status: string;
}
export const useDepartmentStore = createDataStore<DepartmentDoc>();

// Leave Requests
export interface LeaveDoc extends BaseRecord {
  employeeId: string; employeeName: string; department: string;
  leaveType: string; fromDate: string; toDate: string;
  days: number; reason: string; status: string;
  appliedOn: string; approvedBy?: string;
}
export const useLeaveStore = createDataStore<LeaveDoc>();

// Attendance
export interface AttendanceDoc extends BaseRecord {
  employeeId: string; employeeName: string; date: string;
  clockIn: string; clockOut: string; status: string;
  hours: number; overtime: number; location: string;
  clockMethod?: string; shiftType?: string; breakDuration?: number;
  lateMinutes?: number; earlyDepartMinutes?: number;
  remarks?: string;
}
export const useAttendanceStore = createDataStore<AttendanceDoc>();

// Payroll
export interface PayrollDoc extends BaseRecord {
  employeeId: string; employeeName: string; department: string;
  month: string; year: number; basicPay: number; hra: number;
  specialAllowance: number; grossEarnings: number;
  totalDeductions: number; netPay: number; status: string;
  pf?: number; esi?: number; tax?: number; professionalTax?: number;
  conveyance?: number; medical?: number; lta?: number;
  bonus?: number; incentive?: number;
}
export const usePayrollStore = createDataStore<PayrollDoc>();

// Expenses
export interface ExpenseDoc extends BaseRecord {
  employeeId: string; employeeName: string; department: string;
  category: string; amount: number; date: string;
  description: string; status: string; receipt: boolean;
  approvedBy?: string; approvedDate?: string;
  reimbursedDate?: string; paymentMethod?: string;
  invoiceNumber?: string; vendor?: string;
}
export const useExpenseStore = createDataStore<ExpenseDoc>();

// Announcements
export interface AnnouncementDoc extends BaseRecord {
  title: string; content: string; author: string;
  category: string; status: string; pinned: boolean;
  publishedAt: string; expiresAt?: string;
}
export const useAnnouncementStore = createDataStore<AnnouncementDoc>();

// Recruitment Jobs
export interface JobDoc extends BaseRecord {
  title: string; department: string; location: string;
  experienceMin: number; experienceMax: number;
  salaryMin: number; salaryMax: number; description: string;
  status: string; openings: number; applicants: number;
}
export const useJobStore = createDataStore<JobDoc>();

// Helpdesk Tickets
export interface TicketDoc extends BaseRecord {
  title: string; description: string; category: string;
  priority: string; status: string; reporterName: string;
  assigneeName: string; createdAt: string;
  resolvedAt?: string; closedAt?: string;
  slaDeadline?: string; department?: string;
  resolution?: string; feedback?: number;
}
export const useTicketStore = createDataStore<TicketDoc>();

// Training Courses
export interface CourseDoc extends BaseRecord {
  title: string; category: string; type: string;
  instructor: string; duration: string; level: string;
  status: string; enrolled: number; completed: number;
  rating: number; mandatory: boolean;
}
export const useCourseStore = createDataStore<CourseDoc>();

// Goals
export interface GoalDoc extends BaseRecord {
  title: string; description: string; employeeId: string;
  category: string; weight: number; progress: number;
  status: string; dueDate: string;
  assignedBy?: string; reviewedBy?: string;
  milestones?: number; milestonesCompleted?: number;
  priority?: string; department?: string;
}
export const useGoalStore = createDataStore<GoalDoc>();

// Teams
export interface TeamDoc extends BaseRecord {
  name: string; description: string; lead: string;
  department: string; memberCount: number; status: string;
}
export const useTeamStore = createDataStore<TeamDoc>();

// Assets
export interface AssetDoc extends BaseRecord {
  name: string; type: string; brand: string; serialNumber: string;
  status: string; assignedTo: string; cost: number;
  purchaseDate: string; condition: string;
}
export const useAssetStore = createDataStore<AssetDoc>();

// Policies
export interface PolicyDoc extends BaseRecord {
  title: string; category: string; version: string;
  status: string; mandatory: boolean; content: string;
  lastUpdated: string; acknowledgedCount: number;
}
export const usePolicyStore = createDataStore<PolicyDoc>();

// Surveys
export interface SurveyDoc extends BaseRecord {
  title: string; type: string; status: string;
  questions: number; responses: number; deadline: string;
}
export const useSurveyStore = createDataStore<SurveyDoc>();

// WFH Requests
export interface WfhDoc extends BaseRecord {
  employeeId: string; employeeName: string; department: string;
  fromDate: string; toDate: string; days: number;
  reason: string; status: string;
}
export const useWfhStore = createDataStore<WfhDoc>();

// Travel Requests
export interface TravelDoc extends BaseRecord {
  employeeName: string; department: string; destination: string;
  fromDate: string; toDate: string; purpose: string;
  estimatedCost: number; status: string;
}
export const useTravelStore = createDataStore<TravelDoc>();

// Overtime
export interface OvertimeDoc extends BaseRecord {
  employeeName: string; department: string; date: string;
  hours: number; rate: number; amount: number;
  reason: string; status: string;
}
export const useOvertimeStore = createDataStore<OvertimeDoc>();

// Loans
export interface LoanDoc extends BaseRecord {
  employeeName: string; loanType: string; amount: number;
  emi: number; tenure: number; outstanding: number;
  status: string; startDate: string;
}
export const useLoanStore = createDataStore<LoanDoc>();

// Visitors
export interface VisitorDoc extends BaseRecord {
  name: string; company: string; purpose: string;
  host: string; date: string; checkIn: string;
  checkOut: string; status: string;
}
export const useVisitorStore = createDataStore<VisitorDoc>();

// Referrals
export interface ReferralDoc extends BaseRecord {
  referrerName: string; candidateName: string;
  position: string; status: string; bonus: number;
  referredDate: string;
}
export const useReferralStore = createDataStore<ReferralDoc>();

// Feedback
export interface FeedbackDoc extends BaseRecord {
  title: string; category: string; description: string;
  submittedBy: string; status: string; upvotes: number;
  createdAt: string;
}
export const useFeedbackStore = createDataStore<FeedbackDoc>();

// Meeting Bookings
export interface MeetingDoc extends BaseRecord {
  room: string; title: string; organizer: string;
  date: string; startTime: string; endTime: string;
  attendees: number; status: string;
}
export const useMeetingStore = createDataStore<MeetingDoc>();

// Holidays
export interface HolidayDoc extends BaseRecord {
  name: string; date: string; day: string; type: string;
}
export const useHolidayStore = createDataStore<HolidayDoc>();

// Celebrations
export interface CelebrationDoc extends BaseRecord {
  employeeName: string; type: string; date: string;
  department: string; details: string;
}
export const useCelebrationStore = createDataStore<CelebrationDoc>();

// Documents
export interface DocumentDoc extends BaseRecord {
  name: string; type: string; category: string;
  uploadedBy: string; size: string; url: string;
  version: string; status: string;
}
export const useDocumentStore = createDataStore<DocumentDoc>();

// Audit Log
export interface AuditDoc extends BaseRecord {
  userId: string; userName: string; action: string;
  module: string; description: string; timestamp: string;
  severity: string;
}
export const useAuditStore = createDataStore<AuditDoc>();

// Notifications  
export interface NotificationDoc extends BaseRecord {
  type: string; category: string; title: string;
  message: string; read: boolean; starred: boolean;
  recipientId: string; timestamp: string;
  actionUrl?: string; actionLabel?: string;
}
export const useNotifStore = createDataStore<NotificationDoc>();

// ─── Firestore Sync Helpers ──────────────────────────────────

const unsubscribers = new Map<string, () => void>();

export function startSync<T extends BaseRecord>(collectionName: string, store: DataStore<T>) {
  if (unsubscribers.has(collectionName)) return; // Already syncing
  store.setLoading(true);
  const unsub = genericService(collectionName).subscribe(
    (items) => { store.setItems(items as T[]); },
  );
  unsubscribers.set(collectionName, unsub);
}

export function stopSync(collectionName: string) {
  const unsub = unsubscribers.get(collectionName);
  if (unsub) { unsub(); unsubscribers.delete(collectionName); }
}

export function stopAllSyncs() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.clear();
}

// ─── Convenience: Create + Optimistic Add ────────────────────

export async function createAndAdd<T extends BaseRecord>(
  collectionName: string,
  data: Omit<T, "id">,
  store: DataStore<T>
): Promise<string> {
  const tempId = `temp_${Date.now()}`;
  const optimisticItem = { ...data, id: tempId } as T;
  store.addItem(optimisticItem);
  try {
    const realId = await genericService(collectionName).create(data as Record<string, unknown>);
    store.updateItem(tempId, { id: realId } as Partial<T>);
    return realId;
  } catch (err) {
    store.removeItem(tempId);
    throw err;
  }
}

export async function updateAndSync<T extends BaseRecord>(
  collectionName: string,
  id: string,
  updates: Partial<T>,
  store: DataStore<T>
): Promise<void> {
  store.updateItem(id, updates);
  try {
    await genericService(collectionName).update(id, updates as Record<string, unknown>);
  } catch (err) {
    // Revert would need original data - for now just log
    console.error(`Failed to update ${collectionName}/${id}:`, err);
    throw err;
  }
}

export async function removeAndSync<T extends BaseRecord>(
  collectionName: string,
  id: string,
  store: DataStore<T>
): Promise<void> {
  store.removeItem(id);
  try {
    await genericService(collectionName).remove(id);
  } catch (err) {
    console.error(`Failed to delete ${collectionName}/${id}:`, err);
    throw err;
  }
}

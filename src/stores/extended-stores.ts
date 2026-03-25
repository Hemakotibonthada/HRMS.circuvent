import { create } from "zustand";

// ═══════════════════════════════════════════════════════════════
// EXTENDED ZUSTAND STORES — Additional stores for new modules
// covering notifications, calendar, workflow, engagement,
// analytics preferences, and real-time collaboration
// ═══════════════════════════════════════════════════════════════

// ─── Notification Store ──────────────────────────────────────

interface NotificationItem {
  id: string;
  type: "info" | "success" | "warning" | "error" | "action";
  category: string;
  title: string;
  message: string;
  read: boolean;
  starred: boolean;
  actionUrl?: string;
  actionLabel?: string;
  timestamp: string;
  sender?: { name: string; avatar: string };
}

interface NotificationStore {
  notifications: NotificationItem[];
  unreadCount: number;
  preferences: {
    email: boolean;
    push: boolean;
    inApp: boolean;
    sound: boolean;
    digest: "realtime" | "hourly" | "daily" | "weekly";
  };
  addNotification: (notification: Omit<NotificationItem, "id" | "read" | "starred" | "timestamp">) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  toggleStar: (id: string) => void;
  dismiss: (id: string) => void;
  clearRead: () => void;
  updatePreferences: (prefs: Partial<NotificationStore["preferences"]>) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  preferences: {
    email: true,
    push: true,
    inApp: true,
    sound: true,
    digest: "realtime",
  },
  addNotification: (notification) =>
    set((state) => {
      const newNotif: NotificationItem = {
        ...notification,
        id: `N${Date.now()}`,
        read: false,
        starred: false,
        timestamp: new Date().toISOString(),
      };
      return {
        notifications: [newNotif, ...state.notifications],
        unreadCount: state.unreadCount + 1,
      };
    }),
  markRead: (id) =>
    set((state) => {
      const notif = state.notifications.find((n) => n.id === id);
      const wasUnread = notif && !notif.read;
      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      };
    }),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
  toggleStar: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, starred: !n.starred } : n
      ),
    })),
  dismiss: (id) =>
    set((state) => {
      const notif = state.notifications.find((n) => n.id === id);
      const wasUnread = notif && !notif.read;
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      };
    }),
  clearRead: () =>
    set((state) => ({
      notifications: state.notifications.filter((n) => !n.read),
    })),
  updatePreferences: (prefs) =>
    set((state) => ({
      preferences: { ...state.preferences, ...prefs },
    })),
}));

// ─── Calendar / Events Store ─────────────────────────────────

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type: "meeting" | "holiday" | "birthday" | "anniversary" | "training" | "event" | "deadline" | "review";
  description?: string;
  location?: string;
  attendees?: string[];
  color: string;
  allDay: boolean;
  recurring?: "daily" | "weekly" | "monthly" | "yearly";
  reminders?: number[];
  createdBy: string;
}

interface CalendarStore {
  events: CalendarEvent[];
  selectedDate: string;
  view: "month" | "week" | "day" | "agenda";
  filters: string[];
  addEvent: (event: Omit<CalendarEvent, "id">) => void;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  setSelectedDate: (date: string) => void;
  setView: (view: CalendarStore["view"]) => void;
  toggleFilter: (type: string) => void;
  getEventsForDate: (date: string) => CalendarEvent[];
  getUpcomingEvents: (limit: number) => CalendarEvent[];
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  events: [],
  selectedDate: new Date().toISOString().split("T")[0],
  view: "month",
  filters: [],
  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, { ...event, id: `EVT${Date.now()}` }],
    })),
  updateEvent: (id, updates) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),
  deleteEvent: (id) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
    })),
  setSelectedDate: (date) => set({ selectedDate: date }),
  setView: (view) => set({ view }),
  toggleFilter: (type) =>
    set((state) => ({
      filters: state.filters.includes(type)
        ? state.filters.filter((f) => f !== type)
        : [...state.filters, type],
    })),
  getEventsForDate: (date) => get().events.filter((e) => e.date === date),
  getUpcomingEvents: (limit) => {
    const today = new Date().toISOString().split("T")[0];
    return get()
      .events.filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit);
  },
}));

// ─── Workflow / Approval Store ───────────────────────────────

interface WorkflowInstance {
  id: string;
  workflowId: string;
  workflowName: string;
  employeeId: string;
  employeeName: string;
  currentStep: number;
  totalSteps: number;
  status: "pending" | "in_progress" | "completed" | "rejected" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  sla?: string;
  slaDeadline?: string;
}

interface WorkflowStep {
  id: string;
  name: string;
  type: "approval" | "notification" | "action" | "condition" | "wait";
  assignee?: string;
  status: "pending" | "active" | "completed" | "skipped" | "rejected";
  completedAt?: string;
  comments?: string;
}

interface WorkflowStore {
  instances: WorkflowInstance[];
  addInstance: (instance: Omit<WorkflowInstance, "id" | "createdAt" | "updatedAt">) => void;
  updateStep: (instanceId: string, stepId: string, status: WorkflowStep["status"], comments?: string) => void;
  completeInstance: (instanceId: string) => void;
  rejectInstance: (instanceId: string, reason: string) => void;
  cancelInstance: (instanceId: string) => void;
  getMyApprovals: (userId: string) => WorkflowInstance[];
  getInstancesByStatus: (status: WorkflowInstance["status"]) => WorkflowInstance[];
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  instances: [],
  addInstance: (instance) =>
    set((state) => ({
      instances: [
        ...state.instances,
        {
          ...instance,
          id: `WI${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })),
  updateStep: (instanceId, stepId, status, comments) =>
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? {
              ...inst,
              updatedAt: new Date().toISOString(),
              steps: inst.steps.map((s) =>
                s.id === stepId
                  ? { ...s, status, completedAt: new Date().toISOString(), comments }
                  : s
              ),
            }
          : inst
      ),
    })),
  completeInstance: (instanceId) =>
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? { ...inst, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : inst
      ),
    })),
  rejectInstance: (instanceId, _reason) =>
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? { ...inst, status: "rejected", updatedAt: new Date().toISOString() }
          : inst
      ),
    })),
  cancelInstance: (instanceId) =>
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? { ...inst, status: "cancelled", updatedAt: new Date().toISOString() }
          : inst
      ),
    })),
  getMyApprovals: (userId) =>
    get().instances.filter(
      (inst) =>
        inst.status === "in_progress" &&
        inst.steps.some(
          (s) => s.assignee === userId && s.status === "active"
        )
    ),
  getInstancesByStatus: (status) =>
    get().instances.filter((inst) => inst.status === status),
}));

// ─── Engagement / Culture Store ──────────────────────────────

interface KudosEntry {
  id: string;
  from: string;
  to: string;
  message: string;
  value: string;
  emoji: string;
  likes: number;
  timestamp: string;
}

interface PulseResponse {
  id: string;
  question: string;
  score: number;
  respondedAt: string;
}

interface EngagementStore {
  kudos: KudosEntry[];
  pulseResponses: PulseResponse[];
  eNPS: number;
  engagementScore: number;
  addKudos: (kudos: Omit<KudosEntry, "id" | "likes" | "timestamp">) => void;
  likeKudos: (id: string) => void;
  submitPulseResponse: (response: Omit<PulseResponse, "id" | "respondedAt">) => void;
  updateScores: (eNPS: number, engagement: number) => void;
}

export const useEngagementStore = create<EngagementStore>((set) => ({
  kudos: [],
  pulseResponses: [],
  eNPS: 29,
  engagementScore: 82,
  addKudos: (kudos) =>
    set((state) => ({
      kudos: [
        { ...kudos, id: `K${Date.now()}`, likes: 0, timestamp: new Date().toISOString() },
        ...state.kudos,
      ],
    })),
  likeKudos: (id) =>
    set((state) => ({
      kudos: state.kudos.map((k) =>
        k.id === id ? { ...k, likes: k.likes + 1 } : k
      ),
    })),
  submitPulseResponse: (response) =>
    set((state) => ({
      pulseResponses: [
        ...state.pulseResponses,
        { ...response, id: `PR${Date.now()}`, respondedAt: new Date().toISOString() },
      ],
    })),
  updateScores: (eNPS, engagement) => set({ eNPS, engagementScore: engagement }),
}));

// ─── Analytics Preferences Store ─────────────────────────────

interface DashboardWidget {
  id: string;
  type: "stat" | "chart" | "list" | "table";
  title: string;
  size: "sm" | "md" | "lg" | "xl";
  visible: boolean;
  position: number;
  config: Record<string, unknown>;
}

interface AnalyticsStore {
  period: "7d" | "30d" | "90d" | "6m" | "1y" | "ytd";
  department: string;
  widgets: DashboardWidget[];
  favorites: string[];
  recentReports: string[];
  setPeriod: (period: AnalyticsStore["period"]) => void;
  setDepartment: (dept: string) => void;
  toggleWidget: (widgetId: string) => void;
  reorderWidgets: (widgetId: string, newPosition: number) => void;
  addFavorite: (reportId: string) => void;
  removeFavorite: (reportId: string) => void;
  addRecentReport: (reportId: string) => void;
}

export const useAnalyticsStore = create<AnalyticsStore>((set) => ({
  period: "6m",
  department: "all",
  widgets: [],
  favorites: [],
  recentReports: [],
  setPeriod: (period) => set({ period }),
  setDepartment: (department) => set({ department }),
  toggleWidget: (widgetId) =>
    set((state) => ({
      widgets: state.widgets.map((w) =>
        w.id === widgetId ? { ...w, visible: !w.visible } : w
      ),
    })),
  reorderWidgets: (widgetId, newPosition) =>
    set((state) => {
      const widgets = [...state.widgets];
      const oldIndex = widgets.findIndex((w) => w.id === widgetId);
      if (oldIndex === -1) return state;
      const [widget] = widgets.splice(oldIndex, 1);
      widgets.splice(newPosition, 0, widget);
      return { widgets: widgets.map((w, i) => ({ ...w, position: i })) };
    }),
  addFavorite: (reportId) =>
    set((state) => ({
      favorites: state.favorites.includes(reportId)
        ? state.favorites
        : [...state.favorites, reportId],
    })),
  removeFavorite: (reportId) =>
    set((state) => ({
      favorites: state.favorites.filter((f) => f !== reportId),
    })),
  addRecentReport: (reportId) =>
    set((state) => ({
      recentReports: [
        reportId,
        ...state.recentReports.filter((r) => r !== reportId),
      ].slice(0, 10),
    })),
}));

// ─── Search Store ────────────────────────────────────────────

interface SearchResult {
  id: string;
  type: "employee" | "document" | "page" | "announcement" | "ticket" | "policy";
  title: string;
  subtitle: string;
  url: string;
  icon: string;
  relevance: number;
}

interface SearchStore {
  query: string;
  results: SearchResult[];
  isSearching: boolean;
  recentSearches: string[];
  setQuery: (query: string) => void;
  search: (query: string) => Promise<void>;
  clearResults: () => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  query: "",
  results: [],
  isSearching: false,
  recentSearches: [],
  setQuery: (query) => set({ query }),
  search: async (query) => {
    set({ isSearching: true });
    // Simulate search delay
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Mock results based on query
    const mockResults: SearchResult[] = [
      { id: "1", type: "employee" as const, title: "Vikram Mehta", subtitle: "Lead Engineer · Engineering", url: "/employees", icon: "👤", relevance: 95 },
      { id: "2", type: "page" as const, title: "Leave Management", subtitle: "Apply and manage leaves", url: "/leave", icon: "📅", relevance: 80 },
      { id: "3", type: "document" as const, title: "HR Policy Handbook", subtitle: "Latest version · PDF", url: "/documents", icon: "📄", relevance: 75 },
    ].filter((r) => r.title.toLowerCase().includes(query.toLowerCase()));
    set({ results: mockResults, isSearching: false });
  },
  clearResults: () => set({ results: [], query: "" }),
  addRecentSearch: (query) =>
    set((state) => ({
      recentSearches: [
        query,
        ...state.recentSearches.filter((s) => s !== query),
      ].slice(0, 5),
    })),
  clearRecentSearches: () => set({ recentSearches: [] }),
}));

// ─── Onboarding Checklist Store ──────────────────────────────

interface OnboardingTask {
  id: string;
  title: string;
  category: string;
  assignee: string;
  dueDay: number;
  completed: boolean;
  mandatory: boolean;
  description?: string;
}

interface OnboardingProgress {
  employeeId: string;
  employeeName: string;
  tasks: OnboardingTask[];
  startDate: string;
  currentDay: number;
  totalDays: number;
  buddyId?: string;
  managerId: string;
}

interface OnboardingStore {
  checklists: OnboardingProgress[];
  templates: OnboardingTask[];
  addChecklist: (checklist: OnboardingProgress) => void;
  toggleTask: (employeeId: string, taskId: string) => void;
  getProgress: (employeeId: string) => number;
  getActiveOnboardings: () => OnboardingProgress[];
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  checklists: [],
  templates: [],
  addChecklist: (checklist) =>
    set((state) => ({
      checklists: [...state.checklists, checklist],
    })),
  toggleTask: (employeeId, taskId) =>
    set((state) => ({
      checklists: state.checklists.map((c) =>
        c.employeeId === employeeId
          ? {
              ...c,
              tasks: c.tasks.map((t) =>
                t.id === taskId ? { ...t, completed: !t.completed } : t
              ),
            }
          : c
      ),
    })),
  getProgress: (employeeId) => {
    const checklist = get().checklists.find((c) => c.employeeId === employeeId);
    if (!checklist || checklist.tasks.length === 0) return 0;
    return Math.round(
      (checklist.tasks.filter((t) => t.completed).length / checklist.tasks.length) * 100
    );
  },
  getActiveOnboardings: () =>
    get().checklists.filter((c) => {
      const completedTasks = c.tasks.filter((t) => t.completed).length;
      return completedTasks < c.tasks.length;
    }),
}));

// ─── Theme / UI Preferences Store ────────────────────────────

interface UIPreferences {
  sidebarCollapsed: boolean;
  compactMode: boolean;
  animationsEnabled: boolean;
  dateFormat: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";
  currency: "INR" | "USD" | "EUR" | "GBP";
  language: "en" | "hi" | "ta" | "te" | "kn";
  timezone: string;
  theme: "light" | "dark" | "system";
  accentColor: string;
}

interface UIStore {
  preferences: UIPreferences;
  toggleSidebar: () => void;
  toggleCompactMode: () => void;
  toggleAnimations: () => void;
  setDateFormat: (format: UIPreferences["dateFormat"]) => void;
  setCurrency: (currency: UIPreferences["currency"]) => void;
  setLanguage: (language: UIPreferences["language"]) => void;
  setTheme: (theme: UIPreferences["theme"]) => void;
  setAccentColor: (color: string) => void;
  resetPreferences: () => void;
}

const DEFAULT_UI_PREFERENCES: UIPreferences = {
  sidebarCollapsed: false,
  compactMode: false,
  animationsEnabled: true,
  dateFormat: "dd/mm/yyyy",
  currency: "INR",
  language: "en",
  timezone: "Asia/Kolkata",
  theme: "system",
  accentColor: "#8b5cf6",
};

export const useUIStore = create<UIStore>((set) => ({
  preferences: DEFAULT_UI_PREFERENCES,
  toggleSidebar: () =>
    set((state) => ({
      preferences: { ...state.preferences, sidebarCollapsed: !state.preferences.sidebarCollapsed },
    })),
  toggleCompactMode: () =>
    set((state) => ({
      preferences: { ...state.preferences, compactMode: !state.preferences.compactMode },
    })),
  toggleAnimations: () =>
    set((state) => ({
      preferences: { ...state.preferences, animationsEnabled: !state.preferences.animationsEnabled },
    })),
  setDateFormat: (dateFormat) =>
    set((state) => ({ preferences: { ...state.preferences, dateFormat } })),
  setCurrency: (currency) =>
    set((state) => ({ preferences: { ...state.preferences, currency } })),
  setLanguage: (language) =>
    set((state) => ({ preferences: { ...state.preferences, language } })),
  setTheme: (theme) =>
    set((state) => ({ preferences: { ...state.preferences, theme } })),
  setAccentColor: (accentColor) =>
    set((state) => ({ preferences: { ...state.preferences, accentColor } })),
  resetPreferences: () => set({ preferences: DEFAULT_UI_PREFERENCES }),
}));

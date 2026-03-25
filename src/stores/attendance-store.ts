import { create } from "zustand";
import type { AttendanceRecord } from "@/types";

type ViewMode = "daily" | "weekly" | "monthly";

interface AttendanceState {
  records: AttendanceRecord[];
  viewMode: ViewMode;
  selectedDate: string;
  isClockedIn: boolean;
  currentSessionStart: string | null;
  setRecords: (v: AttendanceRecord[]) => void;
  setViewMode: (v: ViewMode) => void;
  setSelectedDate: (v: string) => void;
  setIsClockedIn: (v: boolean) => void;
  setCurrentSessionStart: (v: string | null) => void;
}

export const useAttendanceStore = create<AttendanceState>((set) => ({
  records: [],
  viewMode: "daily",
  selectedDate: new Date().toISOString().split("T")[0],
  isClockedIn: false,
  currentSessionStart: null,
  setRecords: (v) => set({ records: v }),
  setViewMode: (v) => set({ viewMode: v }),
  setSelectedDate: (v) => set({ selectedDate: v }),
  setIsClockedIn: (v) => set({ isClockedIn: v }),
  setCurrentSessionStart: (v) => set({ currentSessionStart: v }),
}));

import { create } from "zustand";
import type { PayrollRecord } from "@/types";

interface PayrollState {
  records: PayrollRecord[];
  selectedMonth: number;
  selectedYear: number;
  filterStatus: string;
  isProcessDialogOpen: boolean;
  selectedRecord: PayrollRecord | null;
  setRecords: (v: PayrollRecord[]) => void;
  setSelectedMonth: (v: number) => void;
  setSelectedYear: (v: number) => void;
  setFilterStatus: (v: string) => void;
  setIsProcessDialogOpen: (v: boolean) => void;
  setSelectedRecord: (v: PayrollRecord | null) => void;
}

export const usePayrollStore = create<PayrollState>((set) => ({
  records: [],
  selectedMonth: new Date().getMonth() + 1,
  selectedYear: new Date().getFullYear(),
  filterStatus: "all",
  isProcessDialogOpen: false,
  selectedRecord: null,
  setRecords: (v) => set({ records: v }),
  setSelectedMonth: (v) => set({ selectedMonth: v }),
  setSelectedYear: (v) => set({ selectedYear: v }),
  setFilterStatus: (v) => set({ filterStatus: v }),
  setIsProcessDialogOpen: (v) => set({ isProcessDialogOpen: v }),
  setSelectedRecord: (v) => set({ selectedRecord: v }),
}));

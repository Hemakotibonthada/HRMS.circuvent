import { create } from "zustand";
import type { LeaveRequest } from "@/types";

interface LeaveState {
  requests: LeaveRequest[];
  filterStatus: string;
  filterType: string;
  isRequestDialogOpen: boolean;
  selectedRequest: LeaveRequest | null;
  setRequests: (v: LeaveRequest[]) => void;
  setFilterStatus: (v: string) => void;
  setFilterType: (v: string) => void;
  setIsRequestDialogOpen: (v: boolean) => void;
  setSelectedRequest: (v: LeaveRequest | null) => void;
}

export const useLeaveStore = create<LeaveState>((set) => ({
  requests: [],
  filterStatus: "all",
  filterType: "all",
  isRequestDialogOpen: false,
  selectedRequest: null,
  setRequests: (v) => set({ requests: v }),
  setFilterStatus: (v) => set({ filterStatus: v }),
  setFilterType: (v) => set({ filterType: v }),
  setIsRequestDialogOpen: (v) => set({ isRequestDialogOpen: v }),
  setSelectedRequest: (v) => set({ selectedRequest: v }),
}));

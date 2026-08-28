import { create } from "zustand";
import type { Employee } from "@/types";

type ViewMode = "grid" | "list" | "org-chart";
type SortBy = "name" | "department" | "joinDate" | "designation";

interface EmployeeState {
  employees: Employee[];
  selectedEmployee: Employee | null;
  viewMode: ViewMode;
  sortBy: SortBy;
  filterDepartment: string;
  filterStatus: string;
  searchQuery: string;
  isAddDialogOpen: boolean;
  isEditDialogOpen: boolean;
  setEmployees: (v: Employee[]) => void;
  setSelectedEmployee: (v: Employee | null) => void;
  setViewMode: (v: ViewMode) => void;
  setSortBy: (v: SortBy) => void;
  setFilterDepartment: (v: string) => void;
  setFilterStatus: (v: string) => void;
  setSearchQuery: (v: string) => void;
  setIsAddDialogOpen: (v: boolean) => void;
  setIsEditDialogOpen: (v: boolean) => void;
}

export const useEmployeeStore = create<EmployeeState>((set) => ({
  employees: [],
  selectedEmployee: null,
  viewMode: "grid",
  sortBy: "name",
  filterDepartment: "all",
  filterStatus: "all",
  searchQuery: "",
  isAddDialogOpen: false,
  isEditDialogOpen: false,
  setEmployees: (v) => set({ employees: v }),
  setSelectedEmployee: (v) => set({ selectedEmployee: v }),
  setViewMode: (v) => set({ viewMode: v }),
  setSortBy: (v) => set({ sortBy: v }),
  setFilterDepartment: (v) => set({ filterDepartment: v }),
  setFilterStatus: (v) => set({ filterStatus: v }),
  setSearchQuery: (v) => set({ searchQuery: v }),
  setIsAddDialogOpen: (v) => set({ isAddDialogOpen: v }),
  setIsEditDialogOpen: (v) => set({ isEditDialogOpen: v }),
}));

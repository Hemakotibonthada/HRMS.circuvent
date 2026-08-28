import { create } from "zustand";
import type { UserProfile, Organization } from "@/types";

interface AppState {
  sidebarCollapsed: boolean;
  currentModule: string;
  searchOpen: boolean;
  userProfile: UserProfile | null;
  organization: Organization | null;
  pageTitle: string;
  setSidebarCollapsed: (v: boolean) => void;
  setCurrentModule: (v: string) => void;
  setSearchOpen: (v: boolean) => void;
  setUserProfile: (v: UserProfile | null) => void;
  setOrganization: (v: Organization | null) => void;
  setPageTitle: (v: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  currentModule: "dashboard",
  searchOpen: false,
  userProfile: null,
  organization: null,
  pageTitle: "",
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setCurrentModule: (v) => set({ currentModule: v }),
  setSearchOpen: (v) => set({ searchOpen: v }),
  setUserProfile: (v) => set({ userProfile: v }),
  setOrganization: (v) => set({ organization: v }),
  setPageTitle: (v) => set({ pageTitle: v }),
}));

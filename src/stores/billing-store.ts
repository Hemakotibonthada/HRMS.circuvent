import { create } from "zustand";
import type { Subscription } from "@/types";

interface BillingState {
  subscription: Subscription | null;
  isUpgradeDialogOpen: boolean;
  selectedPlan: string | null;
  setSubscription: (v: Subscription | null) => void;
  setIsUpgradeDialogOpen: (v: boolean) => void;
  setSelectedPlan: (v: string | null) => void;
}

export const useBillingStore = create<BillingState>((set) => ({
  subscription: null,
  isUpgradeDialogOpen: false,
  selectedPlan: null,
  setSubscription: (v) => set({ subscription: v }),
  setIsUpgradeDialogOpen: (v) => set({ isUpgradeDialogOpen: v }),
  setSelectedPlan: (v) => set({ selectedPlan: v }),
}));

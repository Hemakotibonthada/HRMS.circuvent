"use client";
import { createContext, useContext } from "react";
import type { HrmsPortal } from "@/lib/hrms-portals";

const Context = createContext<HrmsPortal>("hrms");
export function HrmsPortalProvider({ portal, children }: { portal: HrmsPortal; children: React.ReactNode }) {
  return <Context.Provider value={portal}>{children}</Context.Provider>;
}
export function useHrmsPortal() { return useContext(Context); }

"use client";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SuiteHeader } from "@/components/suite-header";
import { AuthGuard } from "@/components/auth-guard";
import { CommandPalette } from "@/components/command-palette";
import { useHrmsPortal } from "@/components/hrms-portal-provider";
import { HrmsFocusedShell } from "@/components/hrms-focused-shell";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const portal = useHrmsPortal();
  if (portal !== "hrms") return <AuthGuard><HrmsFocusedShell>{children}</HrmsFocusedShell><CommandPalette /></AuthGuard>;
  return <AuthGuard><SidebarProvider><AppSidebar /><SidebarInset><SuiteHeader />
    <main className="flex-1 overflow-auto"><div className="animate-fade-in">{children}</div></main>
  </SidebarInset></SidebarProvider><CommandPalette /></AuthGuard>;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HrmsPortalProvider } from "@/components/hrms-portal-provider";
const session = vi.hoisted(() => ({ pathname: "/leave", role: "employee" }));
vi.mock("next/navigation", () => ({ usePathname: () => session.pathname }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: session.role, displayName: "Test Person", email: "test@example.test" } }), signOutSession: vi.fn() }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/notification-center", () => ({ NotificationCenter: () => null }));
vi.mock("@/components/ecosystem-switcher", () => ({ EcosystemSwitcher: () => null }));
vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));
import { HrmsFocusedShell } from "@/components/hrms-focused-shell";
import WorkspacePage from "@/app/(dashboard)/workspace/page";

afterEach(cleanup);
describe("focused portal UI", () => {
  it("renders section and feature navigation with active route state", () => {
    session.pathname = "/leave";
    session.role = "employee";
    render(<HrmsPortalProvider portal="employee"><HrmsFocusedShell><p>Page content</p></HrmsFocusedShell></HrmsPortalProvider>);
    expect(screen.getByRole("navigation", { name: "Workspace sections" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Time & leave features" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Leave Management" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Payroll" })).toBeNull();
    expect(screen.getByRole("main").id).toBe("portal-content");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
  it("filters the workspace into a single feature section", () => {
    session.pathname = "/workspace";
    session.role = "employee";
    render(<HrmsPortalProvider portal="employee"><WorkspacePage /></HrmsPortalProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Time & leave", exact: true }));
    expect(screen.getByRole("button", { name: "Time & leave", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Timesheets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All sections" }));
    expect(screen.getByRole("button", { name: "All sections" }).getAttribute("aria-pressed")).toBe("true");
  });
});

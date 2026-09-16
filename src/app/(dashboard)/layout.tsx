import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/auth/tokens";
import { currentEmployeeIdentity } from "@/lib/current-employee";
import { canEnterInternPortal, PORTAL_HEADER } from "@/lib/hrms-portals";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Intern is an employment classification, not an elevated access role.
  if ((await headers()).get(PORTAL_HEADER) === "intern") {
    const claims = await verifyAccessToken((await cookies()).get(ACCESS_COOKIE)?.value ?? "");
    if (!claims) redirect("/login");
    if (!canEnterInternPortal(claims.role, null)) {
      const identity = await currentEmployeeIdentity({ orgId: claims.org, userId: claims.sub, email: claims.email });
      if (!canEnterInternPortal(claims.role, identity?.employmentType)) redirect("/portal-access");
    }
  }
  return <DashboardShell>{children}</DashboardShell>;
}

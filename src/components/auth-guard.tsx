"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { Building2, Lock } from "lucide-react";
import { canAccessModule } from "@/lib/rbac";
import { Button } from "@/components/ui/button";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const rbac = useRBAC();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  // Show loading while auth or role is resolving
  if (loading || rbac.roleLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg animate-pulse-glow">
              <Building2 className="h-7 w-7" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Circuvent HRMS</h2>
            <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 animate-shimmer" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Check route-level RBAC
  const segments = pathname.split("/").filter(Boolean);
  const moduleId = segments[0] || "dashboard";
  if (!rbac.canAccessModule(moduleId)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center p-8 animate-scale-in">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg">
            <Lock className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            You don&apos;t have permission to access this page. Contact your administrator if you believe this is an error.
          </p>
          <Button onClick={() => router.push("/dashboard")} className="mt-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, Settings, User, CreditCard, Landmark } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { groupModulesByCategory } from "@/lib/constants";
import { useAuth, signOutSession } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { getRoleLabel, getRoleBadgeColor } from "@/lib/rbac";
import { useAppStore } from "@/stores/app-store";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const rbac = useRBAC();
  const { organization } = useAppStore();
  const allCategories = groupModulesByCategory();

  // Filter modules based on RBAC
  const categories = allCategories.map(cat => ({
    ...cat,
    items: cat.items.filter(item => {
      const moduleId = item.href.replace("/", "");
      return rbac.canAccessModule(moduleId);
    }),
  })).filter(cat => cat.items.length > 0);

  const handleSignOut = async () => {
    await signOutSession();
    router.push("/login");
  };

  const initials = user?.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? "U";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" className="flex items-center gap-3" />}>
                <BrandMark size={36} className="shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold tracking-tight">
                    {organization?.name ?? "Circuvent HRMS"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Human Resources
                  </span>
                </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {categories.map((cat) => (
          <Collapsible key={cat.key} defaultOpen className="group/collapsible">
            <SidebarGroup>
              <SidebarGroupLabel render={<CollapsibleTrigger className="flex w-full items-center justify-between" />}>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.label}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {cat.items.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={item.name}
                            render={<Link href={item.href} className="flex items-center gap-3" />}
                          >
                              <item.icon
                                className="h-4.5 w-4.5 shrink-0 transition-colors"
                                style={{ color: isActive ? item.color : undefined }}
                              />
                              <span className="truncate">{item.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="w-full" />}>
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-xs text-white font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {user?.displayName || "User"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-muted-foreground">
                        {user?.email}
                      </span>
                    </div>
                    <Badge className={`mt-0.5 text-[9px] border-0 w-fit ${getRoleBadgeColor(rbac.role)}`}>
                      {getRoleLabel(rbac.role)}
                    </Badge>
                  </div>
                  <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem onClick={() => router.push("/myprofile")}>
                  <User className="mr-2 h-4 w-4" /> Profile
                </DropdownMenuItem>
                {/* Lives in the account menu, not the module sidebar list, because
                    it is a personal-payment-detail screen like Profile/Settings
                    rather than a work module. It was built with no entry point
                    anywhere in the app; that gap is exactly how a finished,
                    permissioned page ends up unreachable. */}
                <DropdownMenuItem onClick={() => router.push("/bankdetails")}>
                  <Landmark className="mr-2 h-4 w-4" /> Bank Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                {/* Billing is an account-owner concern. It used to be offered to
                    everyone, so an employee clicking it landed on subscription
                    and payment details that are not theirs to see. */}
                {rbac.isAdmin && (
                  <DropdownMenuItem onClick={() => router.push("/billing")}>
                    <CreditCard className="mr-2 h-4 w-4" /> Billing
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

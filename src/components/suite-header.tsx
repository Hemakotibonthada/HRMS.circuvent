"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationCenter } from "@/components/notification-center";
import { EcosystemSwitcher } from "@/components/ecosystem-switcher";
import { MODULES } from "@/lib/constants";
import { Search } from "lucide-react";

export function SuiteHeader() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const breadcrumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    // Not named `module`: Next.js reserves that identifier, and assigning to
    // it breaks the bundler's module resolution.
    const matched = MODULES.find((m) => m.href === href);
    const label = matched?.name ?? seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { href, label, isLast: i === segments.length - 1 };
  });

  const openCommandPalette = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  };

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border/50 bg-background/80 px-4 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />

      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((bc, i) => (
            <span key={bc.href} className="contents">
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {bc.isLast ? (
                  <BreadcrumbPage className="font-medium">{bc.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={bc.href}>{bc.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={openCommandPalette} className="hidden sm:flex gap-2 text-xs text-muted-foreground h-8 px-3 border border-border/50">
          <Search className="h-3.5 w-3.5" /> Search...
          <kbd className="ml-2 rounded border bg-muted px-1 text-[10px] font-mono">Ctrl+K</kbd>
        </Button>
        <EcosystemSwitcher current="hrms" />
        <NotificationCenter />
        <ThemeToggle />
      </div>
    </header>
  );
}

"use client";

import { LayoutGrid, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ECOSYSTEM_APPS, type EcosystemAppId } from "@/lib/ecosystem";

/**
 * Cross-app launcher. Lists every sibling Circuvent app (resolved from the
 * shared ecosystem config) so users can hop between suites in one click.
 */
export function EcosystemSwitcher({ current }: { current: EcosystemAppId }) {
  const apps = ECOSYSTEM_APPS.filter((app) => app.id !== current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Switch Circuvent app">
          <LayoutGrid className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Circuvent apps</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps.map((app) => (
          <DropdownMenuItem
            key={app.id}
            onSelect={() => window.open(app.url, "_blank", "noopener,noreferrer")}
            className="flex items-start gap-2 cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-none">{app.name}</p>
              <p className="text-xs text-muted-foreground truncate mt-1">{app.description}</p>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

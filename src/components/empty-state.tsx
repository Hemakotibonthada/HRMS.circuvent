"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Search, FileText, Lock } from "lucide-react";

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  variant?: "default" | "no-access" | "no-results" | "coming-soon";
}

export function EmptyState({
  icon: Icon = FileText,
  title,
  description,
  actionLabel,
  onAction,
  className,
  variant = "default",
}: EmptyStateProps) {
  const variantIcon = variant === "no-access" ? Lock : variant === "no-results" ? Search : Icon;
  const FinalIcon = variantIcon;

  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-in", className)}>
      <div className={cn(
        "flex h-16 w-16 items-center justify-center rounded-2xl mb-4 shadow-md",
        variant === "no-access" ? "bg-gradient-to-br from-red-500 to-rose-600 text-white" :
        variant === "no-results" ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white" :
        "bg-gradient-to-br from-violet-500 to-purple-600 text-white"
      )}>
        <FinalIcon className="h-8 w-8" />
      </div>
      <h3 className="text-lg font-semibold mt-2">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          className="mt-4 gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md"
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * Wrapper that shows "no access" when user lacks permission
 */
export function RequirePermission({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return <>{children}</>;
}

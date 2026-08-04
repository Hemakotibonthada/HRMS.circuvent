"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { MODULES } from "@/lib/constants";
import { Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(true); setQuery(""); setSelectedIndex(0); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const filtered = MODULES.filter((m) =>
    `${m.name} ${m.shortName} ${m.description}`.toLowerCase().includes(query.toLowerCase())
  );

  // Clamped during render rather than reset by an effect. Resetting state in
  // an effect triggers a second render pass on every keystroke, and left a
  // frame where selectedIndex pointed past the end of the filtered list.
  const activeIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const handleSelect = (href: string) => { setOpen(false); router.push(href); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[activeIndex]) { handleSelect(filtered[activeIndex].href); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg animate-scale-in">
        <div className="rounded-2xl border bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="h-4.5 w-4.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search modules, features..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">ESC</kbd>
          </div>
          <div className="max-h-72 overflow-auto p-2">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No results found.</p>
            )}
            {filtered.map((mod, i) => (
              <button
                key={mod.id}
                onClick={() => handleSelect(mod.href)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  i === activeIndex ? "bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <mod.icon className="h-4.5 w-4.5" style={{ color: mod.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{mod.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{mod.description}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
          <div className="border-t px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> Navigate</span>
            <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> Open</span>
            <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">Esc</kbd> Close</span>
          </div>
        </div>
      </div>
    </div>
  );
}

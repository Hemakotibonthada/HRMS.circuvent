"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════════
// CUSTOM HOOKS LIBRARY
// Reusable hooks for common HRMS patterns
// ═══════════════════════════════════════════════════════════════════════

// ─── USE DEBOUNCE ────────────────────────────────────────────────────
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// ─── USE LOCAL STORAGE ───────────────────────────────────────────────
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const newValue = value instanceof Function ? value(prev) : value;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(newValue));
      }
      return newValue;
    });
  }, [key]);

  return [storedValue, setValue];
}

// ─── USE SEARCH & FILTER ─────────────────────────────────────────────
export function useSearchFilter<T>(
  items: T[],
  searchFields: (keyof T)[],
  filterFn?: (item: T, filters: Record<string, string>) => boolean
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const debouncedQuery = useDebounce(searchQuery, 200);

  const filtered = useMemo(() => {
    return items.filter(item => {
      // Search match
      if (debouncedQuery) {
        const q = debouncedQuery.toLowerCase();
        const matches = searchFields.some(field => {
          const val = item[field];
          return typeof val === "string" && val.toLowerCase().includes(q);
        });
        if (!matches) return false;
      }
      // Custom filter
      if (filterFn) return filterFn(item, filters);
      return true;
    });
  }, [items, debouncedQuery, searchFields, filterFn, filters]);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  return { filtered, searchQuery, setSearchQuery, filters, setFilter, total: items.length };
}

// ─── USE PAGINATION ──────────────────────────────────────────────────
export function usePagination<T>(items: T[], pageSize: number = 10) {
  const [requestedPage, setRequestedPage] = useState(1);
  const totalPages = Math.ceil(items.length / pageSize);

  // Clamped during render rather than corrected by an effect. The effect
  // version rendered one frame on an out-of-range page — showing an empty
  // table after a filter shrank the result set — and then re-rendered.
  const currentPage = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const goToPage = useCallback((page: number) => {
    setRequestedPage(Math.max(1, page));
  }, []);

  return {
    items: paginatedItems,
    currentPage,
    totalPages,
    goToPage,
    goNext: () => goToPage(currentPage + 1),
    goPrev: () => goToPage(currentPage - 1),
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1,
    total: items.length,
    showing: { from: (currentPage - 1) * pageSize + 1, to: Math.min(currentPage * pageSize, items.length) },
  };
}

// ─── USE SORT ────────────────────────────────────────────────────────
export function useSort<T>(items: T[], defaultKey?: keyof T, defaultDirection: "asc" | "desc" = "asc") {
  const [sortKey, setSortKey] = useState<keyof T | undefined>(defaultKey);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultDirection);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [items, sortKey, sortDirection]);

  const toggleSort = useCallback((key: keyof T) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }, [sortKey]);

  return { sorted, sortKey, sortDirection, toggleSort };
}

// ─── USE SELECTION ───────────────────────────────────────────────────
export function useSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(i => i.id)));
  }, [items]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);
  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === items.length && items.length > 0;
  const someSelected = selectedCount > 0 && selectedCount < items.length;
  const selectedItems = items.filter(i => selectedIds.has(i.id));

  return { selectedIds, toggle, selectAll, deselectAll, isSelected, selectedCount, allSelected, someSelected, selectedItems };
}

// ─── USE COUNTDOWN ───────────────────────────────────────────────────
export function useCountdown(targetDate: Date | string) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: false });

  useEffect(() => {
    const target = typeof targetDate === "string" ? new Date(targetDate) : targetDate;
    const tick = () => {
      const now = new Date();
      const diff = target.getTime() - now.getTime();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
        expired: false,
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

// ─── USE INTERSECTION OBSERVER ───────────────────────────────────────
export function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1, ...options });
    observer.observe(element);
    return () => observer.disconnect();
  }, [options]);

  return { ref, isInView };
}

// ─── USE KEYBOARD SHORTCUT ───────────────────────────────────────────
export function useKeyboardShortcut(key: string, callback: () => void, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modifiers?.ctrl && !e.ctrlKey && !e.metaKey) return;
      if (modifiers?.shift && !e.shiftKey) return;
      if (modifiers?.alt && !e.altKey) return;
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        callback();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, callback, modifiers]);
}

// ─── USE CLIPBOARD ───────────────────────────────────────────────────
export function useClipboard() {
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, []);
  return { copy };
}

// ─── USE TOGGLE ──────────────────────────────────────────────────────
export function useToggle(initialValue = false): [boolean, () => void, (v: boolean) => void] {
  const [value, setValue] = useState(initialValue);
  const toggle = useCallback(() => setValue(v => !v), []);
  return [value, toggle, setValue];
}

// ─── USE COUNTER ─────────────────────────────────────────────────────
export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  return {
    count,
    increment: () => setCount(c => c + 1),
    decrement: () => setCount(c => c - 1),
    reset: () => setCount(initial),
    set: setCount,
  };
}

// ─── USE FORM STATE ──────────────────────────────────────────────────
export function useFormState<T extends Record<string, unknown>>(initialState: T) {
  const [values, setValues] = useState<T>(initialState);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }, []);

  const setError = useCallback(<K extends keyof T>(key: K, error: string) => {
    setErrors(prev => ({ ...prev, [key]: error }));
  }, []);

  const touch = useCallback(<K extends keyof T>(key: K) => {
    setTouched(prev => ({ ...prev, [key]: true }));
  }, []);

  const reset = useCallback(() => {
    setValues(initialState);
    setErrors({});
    setTouched({});
  }, [initialState]);

  const isValid = Object.values(errors).every(e => !e);

  return { values, errors, touched, setValue, setError, touch, reset, isValid };
}

// ─── USE NOTIFICATION COUNT ──────────────────────────────────────────
export function useNotificationCount() {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount(c => c + 1), []);
  const decrement = useCallback(() => setCount(c => Math.max(0, c - 1)), []);
  const clear = useCallback(() => setCount(0), []);
  return { count, increment, decrement, clear, setCount };
}

// ─── USE MEDIA QUERY ─────────────────────────────────────────────────
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setMatches(e.matches);
    handler(mq);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 768px)");
export const useIsTablet = () => useMediaQuery("(max-width: 1024px)");
export const usePrefersDark = () => useMediaQuery("(prefers-color-scheme: dark)");

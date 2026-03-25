"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// ADVANCED HR HOOKS LIBRARY
// Comprehensive collection of custom React hooks for HRMS
// features including data management, form handling, analytics,
// real-time updates, and user interaction utilities
// ═══════════════════════════════════════════════════════════════

// ─── Data Fetching & Caching ─────────────────────────────────

interface UseFetchOptions<T> {
  initialData?: T;
  enabled?: boolean;
  refetchInterval?: number;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

interface UseFetchResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

export function useFetch<T>(
  fetchFn: () => Promise<T>,
  options: UseFetchOptions<T> = {}
): UseFetchResult<T> {
  const { initialData, enabled = true, refetchInterval, onSuccess, onError } = options;
  const [data, setData] = useState<T | undefined>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async (isRefetch = false) => {
    if (isRefetch) setIsRefetching(true);
    else setIsLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      if (mountedRef.current) {
        setData(result);
        onSuccess?.(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        onError?.(e);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, [fetchFn, onSuccess, onError]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) fetchData();
    return () => { mountedRef.current = false; };
  }, [enabled, fetchData]);

  useEffect(() => {
    if (!refetchInterval || !enabled) return;
    const interval = setInterval(() => fetchData(true), refetchInterval);
    return () => clearInterval(interval);
  }, [refetchInterval, enabled, fetchData]);

  return { data, isLoading, error, refetch: () => fetchData(true), isRefetching };
}

// ─── Pagination ──────────────────────────────────────────────

interface UsePaginationOptions {
  totalItems: number;
  pageSize?: number;
  initialPage?: number;
}

interface UsePaginationResult {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setPageSize: (size: number) => void;
  pageRange: number[];
}

export function usePagination({
  totalItems,
  pageSize: initialSize = 10,
  initialPage = 1,
}: UsePaginationOptions): UsePaginationResult {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialSize);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  const nextPage = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);
  const prevPage = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setCurrentPage(1);
  }, []);

  const pageRange = useMemo(() => {
    const range: number[] = [];
    const delta = 2;
    const start = Math.max(1, currentPage - delta);
    const end = Math.min(totalPages, currentPage + delta);
    for (let i = start; i <= end; i++) range.push(i);
    return range;
  }, [currentPage, totalPages]);

  return {
    currentPage, totalPages, pageSize, startIndex, endIndex,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
    goToPage, nextPage, prevPage, setPageSize, pageRange,
  };
}

// ─── Sorting ─────────────────────────────────────────────────

type SortDirection = "asc" | "desc";

interface UseSortResult<T> {
  sortedData: T[];
  sortKey: keyof T | null;
  sortDirection: SortDirection;
  sort: (key: keyof T) => void;
  clearSort: () => void;
}

export function useSort<T extends Record<string, unknown>>(
  data: T[],
  defaultKey?: keyof T,
  defaultDir: SortDirection = "asc"
): UseSortResult<T> {
  const [sortKey, setSortKey] = useState<keyof T | null>(defaultKey ?? null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDir);

  const sort = useCallback((key: keyof T) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }, [sortKey]);

  const clearSort = useCallback(() => {
    setSortKey(null);
    setSortDirection("asc");
  }, []);

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [data, sortKey, sortDirection]);

  return { sortedData, sortKey, sortDirection, sort, clearSort };
}

// ─── Selection / Multi-Select ────────────────────────────────

interface UseSelectionResult<T> {
  selected: Set<T>;
  isSelected: (item: T) => boolean;
  toggle: (item: T) => void;
  selectAll: (items: T[]) => void;
  clearAll: () => void;
  isAllSelected: (items: T[]) => boolean;
  selectedCount: number;
  toggleAll: (items: T[]) => void;
}

export function useSelection<T>(): UseSelectionResult<T> {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const isSelected = useCallback((item: T) => selected.has(item), [selected]);

  const toggle = useCallback((item: T) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  }, []);

  const selectAll = useCallback((items: T[]) => {
    setSelected(new Set(items));
  }, []);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  const isAllSelected = useCallback(
    (items: T[]) => items.length > 0 && items.every(item => selected.has(item)),
    [selected]
  );

  const toggleAll = useCallback((items: T[]) => {
    if (items.every(item => selected.has(item))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items));
    }
  }, [selected]);

  return {
    selected, isSelected, toggle, selectAll, clearAll,
    isAllSelected, selectedCount: selected.size, toggleAll,
  };
}

// ─── Filter ──────────────────────────────────────────────────

interface UseFilterResult<T> {
  filters: Record<string, string>;
  filteredData: T[];
  setFilter: (key: string, value: string) => void;
  clearFilter: (key: string) => void;
  clearAllFilters: () => void;
  activeFilterCount: number;
}

export function useFilter<T extends Record<string, unknown>>(
  data: T[],
  filterConfig: Record<string, (item: T, value: string) => boolean>
): UseFilterResult<T> {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const setFilter = useCallback((key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilter = useCallback((key: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => setFilters({}), []);

  const activeFilterCount = Object.values(filters).filter(v => v && v !== "all").length;

  const filteredData = useMemo(() => {
    return data.filter(item => {
      return Object.entries(filters).every(([key, value]) => {
        if (!value || value === "all") return true;
        const filterFn = filterConfig[key];
        return filterFn ? filterFn(item, value) : true;
      });
    });
  }, [data, filters, filterConfig]);

  return { filters, filteredData, setFilter, clearFilter, clearAllFilters, activeFilterCount };
}

// ─── Form State Management ───────────────────────────────────

interface UseFormOptions<T> {
  initialValues: T;
  validate?: (values: T) => Partial<Record<keyof T, string>>;
  onSubmit?: (values: T) => void | Promise<void>;
}

interface UseFormResult<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isSubmitting: boolean;
  isValid: boolean;
  isDirty: boolean;
  setValue: (key: keyof T, value: T[keyof T]) => void;
  setValues: (values: Partial<T>) => void;
  handleSubmit: (e?: React.FormEvent) => void;
  reset: () => void;
  touchField: (key: keyof T) => void;
  getFieldProps: (key: keyof T) => {
    value: T[keyof T];
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onBlur: () => void;
  };
}

export function useForm<T extends Record<string, unknown>>({
  initialValues,
  validate,
  onSubmit,
}: UseFormOptions<T>): UseFormResult<T> {
  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues),
    [values, initialValues]
  );

  const isValid = useMemo(
    () => Object.keys(errors).length === 0,
    [errors]
  );

  const runValidation = useCallback((vals: T) => {
    if (!validate) return {};
    return validate(vals);
  }, [validate]);

  const setValue = useCallback((key: keyof T, value: T[keyof T]) => {
    setValuesState(prev => {
      const next = { ...prev, [key]: value };
      const errs = runValidation(next);
      setErrors(errs);
      return next;
    });
  }, [runValidation]);

  const setValues = useCallback((partial: Partial<T>) => {
    setValuesState(prev => {
      const next = { ...prev, ...partial };
      const errs = runValidation(next);
      setErrors(errs);
      return next;
    });
  }, [runValidation]);

  const touchField = useCallback((key: keyof T) => {
    setTouched(prev => ({ ...prev, [key]: true }));
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const allTouched: Partial<Record<keyof T, boolean>> = {};
    for (const key of Object.keys(values) as (keyof T)[]) {
      allTouched[key] = true;
    }
    setTouched(allTouched);

    const errs = runValidation(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit?.(values);
    } finally {
      setIsSubmitting(false);
    }
  }, [values, runValidation, onSubmit]);

  const reset = useCallback(() => {
    setValuesState(initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  const getFieldProps = useCallback((key: keyof T) => ({
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue(key, e.target.value as T[keyof T]);
    },
    onBlur: () => touchField(key),
  }), [values, setValue, touchField]);

  return {
    values, errors, touched, isSubmitting, isValid, isDirty,
    setValue, setValues, handleSubmit, reset, touchField, getFieldProps,
  };
}

// ─── Debounced Value ─────────────────────────────────────────

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ─── Debounced Callback ──────────────────────────────────────

export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    ((...args: unknown[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callback(...args), delay);
    }) as T,
    [callback, delay]
  );
}

// ─── Local Storage ───────────────────────────────────────────

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

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue(prev => {
        const newValue = value instanceof Function ? value(prev) : value;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(key, JSON.stringify(newValue));
        }
        return newValue;
      });
    },
    [key]
  );

  return [storedValue, setValue];
}

// ─── Clipboard ───────────────────────────────────────────────

interface UseClipboardResult {
  copy: (text: string) => Promise<void>;
  copied: boolean;
  reset: () => void;
}

export function useClipboard(timeout = 2000): UseClipboardResult {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), timeout);
    } catch {
      setCopied(false);
    }
  }, [timeout]);

  const reset = useCallback(() => {
    setCopied(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { copy, copied, reset };
}

// ─── Keyboard Shortcut ───────────────────────────────────────

export function useKeyboardShortcut(
  keys: string[],
  callback: () => void,
  options: { enabled?: boolean; preventDefault?: boolean } = {}
): void {
  const { enabled = true, preventDefault = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const pressedKeys = new Set<string>();
      if (event.metaKey || event.ctrlKey) pressedKeys.add("mod");
      if (event.shiftKey) pressedKeys.add("shift");
      if (event.altKey) pressedKeys.add("alt");
      pressedKeys.add(event.key.toLowerCase());

      const targetKeys = new Set(keys.map(k => k.toLowerCase()));
      if (
        pressedKeys.size === targetKeys.size &&
        [...targetKeys].every(k => pressedKeys.has(k))
      ) {
        if (preventDefault) event.preventDefault();
        callback();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keys, callback, enabled, preventDefault]);
}

// ─── Media Query ─────────────────────────────────────────────

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

// ─── Intersection Observer (Infinite Scroll / Lazy Load) ─────

export function useIntersectionObserver(
  callback: () => void,
  options: IntersectionObserverInit = {}
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          callbackRef.current();
        }
      },
      { threshold: 0.1, ...options }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [options]);

  return ref;
}

// ─── Toggle ──────────────────────────────────────────────────

export function useToggle(initial = false): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue(prev => !prev), []);
  return [value, toggle, setValue];
}

// ─── Counter ─────────────────────────────────────────────────

export function useCounter(initial = 0, { min, max }: { min?: number; max?: number } = {}) {
  const [count, setCount] = useState(initial);

  const increment = useCallback(() => {
    setCount(prev => max !== undefined ? Math.min(prev + 1, max) : prev + 1);
  }, [max]);

  const decrement = useCallback(() => {
    setCount(prev => min !== undefined ? Math.max(prev - 1, min) : prev - 1);
  }, [min]);

  const reset = useCallback(() => setCount(initial), [initial]);
  const set = useCallback((value: number) => {
    let v = value;
    if (min !== undefined) v = Math.max(v, min);
    if (max !== undefined) v = Math.min(v, max);
    setCount(v);
  }, [min, max]);

  return { count, increment, decrement, reset, set };
}

// ─── Previous Value ──────────────────────────────────────────

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>(undefined);
  useEffect(() => { ref.current = value; });
  return ref.current;
}

// ─── Window Size ─────────────────────────────────────────────

export function useWindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateSize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  return size;
}

// ─── Document Title ──────────────────────────────────────────

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${title} | Circuvent HRMS`;
    return () => { document.title = prevTitle; };
  }, [title]);
}

// ─── Interval ────────────────────────────────────────────────

export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// ─── Click Outside ───────────────────────────────────────────

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

// ─── Scroll Position ─────────────────────────────────────────

export function useScrollPosition() {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handler = () => setPosition({ x: window.scrollX, y: window.scrollY });
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return position;
}

// ─── Online Status ───────────────────────────────────────────

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return isOnline;
}

// ─── Countdown Timer ─────────────────────────────────────────

interface UseCountdownResult {
  timeLeft: number;
  isRunning: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  formatted: { days: number; hours: number; minutes: number; seconds: number };
}

export function useCountdown(targetSeconds: number): UseCountdownResult {
  const [timeLeft, setTimeLeft] = useState(targetSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);
  const reset = useCallback(() => {
    setIsRunning(false);
    setTimeLeft(targetSeconds);
  }, [targetSeconds]);

  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [isRunning, timeLeft]);

  const formatted = useMemo(() => ({
    days: Math.floor(timeLeft / 86400),
    hours: Math.floor((timeLeft % 86400) / 3600),
    minutes: Math.floor((timeLeft % 3600) / 60),
    seconds: timeLeft % 60,
  }), [timeLeft]);

  return { timeLeft, isRunning, start, pause, reset, formatted };
}

// ─── Notification Permission ─────────────────────────────────

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied" as NotificationPermission;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  return { permission, requestPermission };
}

// ─── Step / Wizard ───────────────────────────────────────────

interface UseStepResult {
  currentStep: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  progress: number;
  goTo: (step: number) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
}

export function useStep(totalSteps: number, initialStep = 0): UseStepResult {
  const [currentStep, setCurrentStep] = useState(initialStep);

  return {
    currentStep,
    totalSteps,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === totalSteps - 1,
    progress: totalSteps > 1 ? (currentStep / (totalSteps - 1)) * 100 : 100,
    goTo: (step: number) => setCurrentStep(Math.max(0, Math.min(step, totalSteps - 1))),
    next: () => setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1)),
    prev: () => setCurrentStep(prev => Math.max(prev - 1, 0)),
    reset: () => setCurrentStep(initialStep),
  };
}

// ─── Bulk Actions ────────────────────────────────────────────

interface UseBulkActionsResult<T> {
  selectedItems: T[];
  isProcessing: boolean;
  execute: (action: string, items: T[]) => Promise<void>;
  progress: number;
}

export function useBulkActions<T>(
  actionHandlers: Record<string, (items: T[]) => Promise<void>>
): UseBulkActionsResult<T> {
  const [selectedItems, setSelectedItems] = useState<T[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const execute = useCallback(async (action: string, items: T[]) => {
    const handler = actionHandlers[action];
    if (!handler) return;

    setIsProcessing(true);
    setProgress(0);
    setSelectedItems(items);

    try {
      await handler(items);
      setProgress(100);
    } finally {
      setIsProcessing(false);
    }
  }, [actionHandlers]);

  return { selectedItems, isProcessing, execute, progress };
}

// ─── Theme ───────────────────────────────────────────────────

export function useThemeDetector(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setTheme(mediaQuery.matches ? "dark" : "light");
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return theme;
}

// ─── Focus Trap ──────────────────────────────────────────────

export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const element = ref.current;
    const focusableEls = element.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl?.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl?.focus();
        }
      }
    };

    element.addEventListener("keydown", handleTab);
    firstEl?.focus();
    return () => element.removeEventListener("keydown", handleTab);
  }, [ref, active]);
}

// ═══════════════════════════════════════════════════════════════
// Sync contract
// ═══════════════════════════════════════════════════════════════
// Two failures put whole pages on a permanent skeleton or crashed them
// outright. Both were silent — nothing surfaced beyond a console line — so
// they are pinned here rather than left to code review.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── 1. A failing employee subscription must clear `loading` ────────────────
//
// startSync() flips loading on before subscribing. The employees branch
// returned early and never passed an error handler, so when /api/employees
// failed the flag stayed on and every page gated on it — dashboard, orgchart,
// selfservice, journey — rendered a skeleton that never resolved.

const subscribeMock = vi.fn();

vi.mock("@/db/repositories", () => ({
  employeeRepository: () => ({ subscribe: subscribeMock }),
}));

vi.mock("@/lib/collection-service", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/collection-service");
  return {
    ...actual,
    genericService: () => ({ subscribe: vi.fn(() => () => {}) }),
  };
});

describe("startSync: employees error path", () => {
  beforeEach(() => {
    vi.resetModules();
    subscribeMock.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("clears loading and records the error when the subscription fails", async () => {
    const { startSync, stopAllSyncs } = await import("./unified-store");
    const { COLLECTIONS } = await import("@/lib/collection-service");
    stopAllSyncs();

    // Fail on the first poll, before any data is delivered.
    subscribeMock.mockImplementation((_onChange, _q, onError) => {
      onError?.(new Error("401 Unauthorized"));
      return () => {};
    });

    const state = { loading: false, error: null as string | null, items: [] as unknown[] };
    const store = {
      setItems: (items: unknown[]) => { state.items = items; state.loading = false; },
      setLoading: (v: boolean) => { state.loading = v; },
      setError: (e: string | null) => { state.error = e; },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startSync(COLLECTIONS.employees, store as any);

    expect(state.loading).toBe(false);
    expect(state.error).toBe("401 Unauthorized");
    stopAllSyncs();
  });

  it("passes an error handler at all — the branch used to return without one", async () => {
    const { startSync, stopAllSyncs } = await import("./unified-store");
    const { COLLECTIONS } = await import("@/lib/collection-service");
    stopAllSyncs();

    subscribeMock.mockImplementation(() => () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startSync(COLLECTIONS.employees, { setItems() {}, setLoading() {}, setError() {} } as any);

    expect(subscribeMock).toHaveBeenCalled();
    expect(typeof subscribeMock.mock.calls[0][2]).toBe("function");
    stopAllSyncs();
  });
});

// ─── 2. No page may re-enter the render loop ────────────────────────────────
//
// `const store = useXStore()` takes no selector, so it returns the entire
// zustand state. Any set() replaces that object, so an effect that calls
// store.setLoading() while listing `store` as a dependency re-triggers
// itself forever — and re-fires its fetch on every pass. React eventually
// throws "Maximum update depth exceeded" and the boundary shows
// "This page couldn't load". Ten pages shipped this way.
//
// The tempting fix is to let exhaustive-deps autofix add the store back, so
// this guard exists to make that fail loudly.

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** Extracts every `useEffect(...)` call with its dependency array. */
function effectsIn(src: string): { deps: string[]; body: string }[] {
  const found: { deps: string[]; body: string }[] = [];
  let idx = 0;
  while ((idx = src.indexOf("useEffect(", idx)) !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = src.indexOf("(", idx); i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) break;
    const block = src.slice(idx, end + 1);
    idx = end;
    const match = block.match(/\}\s*,\s*\[([^\]]*)\]\s*\)$/);
    if (!match) continue;
    found.push({
      deps: match[1].split(",").map((d) => d.trim()).filter(Boolean),
      body: block.slice(0, block.length - match[0].length),
    });
  }
  return found;
}

const MUTATORS =
  /\b(store|\w+Store)\.(setItems|setLoading|setError|addItem|updateItem|removeItem|reset)\s*\(/;

describe("no page mutates a store it depends on", () => {
  it("finds no effect that both calls a store setter and lists that store as a dep", () => {
    const offenders: string[] = [];

    for (const file of pageFiles(join(process.cwd(), "src", "app"))) {
      for (const effect of effectsIn(readFileSync(file, "utf8"))) {
        const storeDep = effect.deps.find((d) => d === "store" || /^\w+Store$/.test(d));
        if (storeDep && MUTATORS.test(effect.body)) {
          offenders.push(`${file.replace(process.cwd(), "")} (dep: ${storeDep})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the detector actually detects — a known-bad sample is caught", () => {
    const bad = `
      useEffect(() => {
        if (!initialized) {
          store.setLoading(true);
          genericService("x").getAll().then((d) => store.setItems(d));
        }
      }, [initialized, store]);
    `;
    const [effect] = effectsIn(bad);
    expect(effect.deps).toContain("store");
    expect(MUTATORS.test(effect.body)).toBe(true);
  });
});

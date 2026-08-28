// ═══════════════════════════════════════════════════════════════
// ROUTE SWEEP — does every page and endpoint actually respond?
// ═══════════════════════════════════════════════════════════════
//
// Walks the app directory, derives every route, and requests it against a
// running server.
//
// The point is not coverage, it is the difference between a route that refuses
// politely and one that falls over. A 401 from an API and a redirect from a
// dashboard page are correct answers for an unauthenticated caller. A 500 is a
// crash, and a 404 on a path the router should know about means the page is
// reaching for something that is not there — which is exactly how this
// codebase has failed before, silently, because a failed load and an empty
// tenant render the same way.
//
//   npm run test:routes            (server must already be running)
//   npm run test:routes -- --base http://localhost:3000

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3000";
const COOKIE = process.env.SWEEP_COOKIE ?? "";

interface Route {
  path: string;
  kind: "page" | "api";
  file: string;
}

/** Turns an app-router directory into the URL it serves. */
function routeFor(dir: string, root: string): string {
  const relative = dir.slice(root.length).replace(/\\/g, "/");

  const segments = relative
    .split("/")
    .filter(Boolean)
    // Route groups such as (dashboard) shape the tree, not the URL.
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    // Parallel and intercepting routes are not addressable directly.
    .filter((s) => !s.startsWith("@"));

  return "/" + segments.join("/");
}

function collect(dir: string, root: string, out: Route[] = []): Route[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      collect(path, root, out);
      continue;
    }

    if (entry === "page.tsx") out.push({ path: routeFor(dir, root), kind: "page", file: path });
    if (entry === "route.ts") out.push({ path: routeFor(dir, root), kind: "api", file: path });
  }
  return out;
}

/** Dynamic segments cannot be fetched without a real id. */
function isDynamic(path: string): boolean {
  return /\[|\]/.test(path);
}

interface Result {
  route: Route;
  status: number;
  ms: number;
  note?: string;
}

async function request(route: Route): Promise<Result> {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${route.path}`, {
      redirect: "manual",
      headers: COOKIE ? { cookie: COOKIE } : {},
      signal: AbortSignal.timeout(30_000),
    });
    return { route, status: response.status, ms: Date.now() - started };
  } catch (error) {
    return {
      route,
      status: 0,
      ms: Date.now() - started,
      note: (error as Error).message.slice(0, 80),
    };
  }
}

/**
 * Whether a status is an acceptable answer for this caller.
 *
 * Unauthenticated, so 401 and 403 are correct and a redirect to a login page
 * is correct. 200 is fine — plenty of pages render a shell and fetch on the
 * client. What is never fine is a 500, and a 404 means the router does not
 * know a path that exists on disk.
 */
function acceptable(status: number): boolean {
  return [200, 204, 301, 302, 303, 307, 308, 401, 403, 405, 429].includes(status);
}

async function main() {
  const root = join(process.cwd(), "src", "app");
  if (!existsSync(root)) {
    console.log("No src/app directory");
    process.exitCode = 1;
    return;
  }

  const all = collect(root, root);
  const testable = all.filter((r) => !isDynamic(r.path));
  const skipped = all.length - testable.length;

  console.log(`\n${all.length} routes on disk · ${testable.length} addressable · ${skipped} dynamic\n`);
  console.log(`Base: ${BASE}${COOKIE ? " (authenticated)" : " (anonymous)"}\n`);

  const results: Result[] = [];

  // Sequential on purpose. A dev server compiles on first request, and forty
  // parallel compiles produce timeouts that look like failures.
  for (const route of testable) {
    results.push(await request(route));
  }

  const bad = results.filter((r) => !acceptable(r.status));
  const slow = results.filter((r) => r.ms > 8000 && acceptable(r.status));

  const byStatus = new Map<number, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  console.log("status distribution:");
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${status || "ERR"}  ${count}`);
  }

  if (bad.length > 0) {
    console.log(`\nProblems (${bad.length}):`);
    for (const r of bad) {
      console.log(`  ${String(r.status || "ERR").padEnd(4)} ${r.route.kind.padEnd(4)} ${r.route.path}${r.note ? `  — ${r.note}` : ""}`);
    }
  }

  if (slow.length > 0) {
    console.log(`\nSlowest responses:`);
    for (const r of slow.sort((a, b) => b.ms - a.ms).slice(0, 10)) {
      console.log(`  ${String(r.ms).padStart(6)}ms  ${r.route.path}`);
    }
  }

  console.log(`\n${results.length - bad.length}/${results.length} routes answered acceptably.\n`);
  if (bad.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.log("ERROR:", (e as Error).message.slice(0, 300));
  process.exitCode = 1;
});

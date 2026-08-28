// Audits every dashboard page's data path.
//
// Two bugs reported from production in a row had the same shape: a page asking
// for a collection that nothing serves.
//
//   * Payroll   — no entity route, and excluded from the document store
//   * Employees — department picker sending a name where a uuid was required
//
// `genericService(COLLECTIONS.x)` resolves in two steps: `ENTITY_ROUTES` for
// collections with a real table, falling back to `/api/collections/<x>` for
// the free-form document store. A collection in *neither* 404s on every read
// and every write — and the page shows an empty state, because a failed load
// and an empty result look identical.
//
// This finds the rest of them, rather than waiting for each to be reported.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD = "src/app/(dashboard)";

function pageFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) pageFiles(path, acc);
    else if (entry === "page.tsx") acc.push(path);
  }
  return acc;
}

function extractSet(source: string, marker: RegExp): Set<string> {
  const found = new Set<string>();
  const start = source.search(marker);
  if (start === -1) return found;

  // Read to the closing bracket of the literal that follows the marker.
  const tail = source.slice(start);
  const end = tail.search(/\n\}\)?;|\n\]\);/);
  const block = tail.slice(0, end === -1 ? 2000 : end);

  for (const m of block.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9_]*)["'`]/g)) found.add(m[1]);
  return found;
}

const collectionService = readFileSync("src/lib/collection-service.ts", "utf8");
const docStoreRoute = readFileSync("src/app/api/collections/[collection]/route.ts", "utf8");

// ENTITY_ROUTES keys — collections with their own table and route.
const entityRoutes = new Set<string>();
{
  const block = collectionService.slice(collectionService.indexOf("const ENTITY_ROUTES"));
  const end = block.indexOf("};");
  for (const m of block.slice(0, end).matchAll(/^\s*(\w+):\s*"/gm)) entityRoutes.add(m[1]);
}

const allowedDocStore = extractSet(docStoreRoute, /ALLOWED_COLLECTIONS = new Set\(\[/);

// COLLECTIONS map: the name each key resolves to.
const collectionNames = new Map<string, string>();
{
  const block = collectionService.slice(collectionService.indexOf("export const COLLECTIONS"));
  const end = block.indexOf("};");
  for (const m of block.slice(0, end).matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)) {
    collectionNames.set(m[1], m[2]);
  }
}

console.log(`ENTITY_ROUTES:        ${entityRoutes.size}`);
console.log(`Document store allow: ${allowedDocStore.size}`);
console.log(`COLLECTIONS keys:     ${collectionNames.size}\n`);

interface Broken {
  page: string;
  key: string;
  name: string;
}

const broken: Broken[] = [];
const pages = pageFiles(DASHBOARD);

for (const page of pages) {
  const raw = readFileSync(page, "utf8");

  // Comments mention collection names when explaining why a page moved off
  // one. Stripping them keeps a fixed page from being reported forever.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(\/\/|\*).*$/gm, "");

  // Only pages that actually perform I/O through the generic service.
  if (!/genericService\(|startSync\(/.test(source)) continue;

  const used = new Set<string>();
  for (const m of source.matchAll(/COLLECTIONS\.(\w+)/g)) used.add(m[1]);

  for (const key of used) {
    const name = collectionNames.get(key);
    if (!name) continue;
    if (entityRoutes.has(name) || allowedDocStore.has(name)) continue;

    broken.push({ page: page.replace(/\\/g, "/").replace(`${DASHBOARD}/`, "").replace("/page.tsx", ""), key, name });
  }
}

console.log(`Scanned ${pages.length} dashboard pages.\n`);

if (broken.length === 0) {
  console.log("No page reads or writes a collection that nothing serves.");
} else {
  console.log("Pages using a collection with NO route (404 on every request):\n");
  for (const b of broken) {
    console.log(`  ${b.page.padEnd(24)} COLLECTIONS.${b.key}  ->  "${b.name}"`);
  }
  console.log(`\n${broken.length} broken data path${broken.length === 1 ? "" : "s"}.`);
}

process.exit(broken.length === 0 ? 0 : 1);

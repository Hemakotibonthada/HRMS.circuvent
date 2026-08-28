// Throwaway audit: which columns do repositories filter and sort on, and are
// those columns actually indexed?
//
// An unindexed WHERE or ORDER BY is a sequential scan. On a multi-tenant table
// that grows with every customer, that is the difference between a page that
// loads and one that times out at the worst possible moment — when the biggest
// tenant is using it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = "src/db/schema";
const REPO_DIR = "src/db/repositories";

const indexed = new Map<string, Set<string>>();

for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(join(SCHEMA_DIR, file), "utf8");

  // export const foo = hrms.table("foo", {...}, (t) => [ index("x").on(t.a, t.b) ])
  for (const table of source.matchAll(
    /export const (\w+) = \w+\.table\(\s*"([^"]+)"([\s\S]*?)\n\);/g
  )) {
    const [, varName, , body] = table;
    const cols = new Set<string>();
    for (const idx of body.matchAll(/[Ii]ndex\("[^"]+"\)\.on\(([^)]+)\)/g)) {
      for (const col of idx[1].split(",")) {
        const clean = col.trim().replace(/^t\./, "");
        if (clean) cols.add(clean);
      }
    }
    indexed.set(varName, cols);
  }
}

console.log(`Tables in schema: ${indexed.size}\n`);

// Columns repositories filter or order by.
const used = new Map<string, Map<string, number>>();

for (const file of readdirSync(REPO_DIR).filter((f) => f.endsWith(".neon.ts"))) {
  const source = readFileSync(join(REPO_DIR, file), "utf8");

  for (const m of source.matchAll(/\b(?:eq|gte?|lte?|inArray|ne|like|ilike)\((\w+)\.(\w+)/g)) {
    const [, table, column] = m;
    if (!indexed.has(table)) continue;
    if (!used.has(table)) used.set(table, new Map());
    const cols = used.get(table)!;
    cols.set(column, (cols.get(column) ?? 0) + 1);
  }

  for (const m of source.matchAll(/orderBy\([^)]*?\b(?:asc|desc)\((\w+)\.(\w+)/g)) {
    const [, table, column] = m;
    if (!indexed.has(table)) continue;
    if (!used.has(table)) used.set(table, new Map());
    const cols = used.get(table)!;
    cols.set(column, (cols.get(column) ?? 0) + 2); // ordering hurts more
  }
}

interface Gap {
  table: string;
  column: string;
  uses: number;
}
const gaps: Gap[] = [];

for (const [table, columns] of used) {
  const have = indexed.get(table) ?? new Set();
  for (const [column, uses] of columns) {
    // `id` is the primary key; org_id is covered by every composite index and
    // by RLS itself.
    if (column === "id" || column === "orgId") continue;
    if (!have.has(column)) gaps.push({ table, column, uses });
  }
}

gaps.sort((a, b) => b.uses - a.uses);

console.log("Filtered or sorted but NOT indexed (highest use first):\n");
for (const g of gaps) {
  console.log(`  ${String(g.uses).padStart(3)}x  ${g.table}.${g.column}`);
}
console.log(`\n${gaps.length} candidate gaps.`);

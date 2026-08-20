const fs = require("fs");
const path = require("path");

const apiRoot = path.join(__dirname, "src", "app", "api");

function walk(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
      const rel = path.relative(base, dir).split(path.sep).join("/");
      out.push(rel);
    }
  }
  return out;
}

const routes = walk(apiRoot, apiRoot).sort();
console.log("TOTAL_ROUTE_FILES", routes.length);

// Group by first path segment
const groups = {};
for (const r of routes) {
  const seg = r.split("/")[0];
  groups[seg] = groups[seg] || [];
  groups[seg].push(r);
}

const sortedGroups = Object.keys(groups).sort();
console.log("GROUP_COUNT", sortedGroups.length);
for (const g of sortedGroups) {
  console.log(`\n### ${g} (${groups[g].length})`);
  for (const r of groups[g]) {
    // count HTTP methods exported
    const filePath = path.join(apiRoot, r, "route.ts");
    let methods = [];
    try {
      const src = fs.readFileSync(filePath, "utf8");
      const m = src.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g) || [];
      methods = m.map((x) => x.replace(/export\s+(?:async\s+)?function\s+/, ""));
    } catch {}
    console.log(`  /api/${r}  [${methods.join(",")}]`);
  }
}

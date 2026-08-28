// Proves each application credential reaches its own database and no other.
//
// The check that matters is the negative one, so it is written as an
// experiment rather than an inspection of grants: take the credential the app
// really uses, point it at a database it has no business opening, and require
// the connection to be refused.

import { readFileSync } from "node:fs";
import pg from "pg";

const ROOT = "C:\\Users\\v-hbonthada\\WorkSpace-Pract\\Office Apps\\Office Apps";

function urlOf(app: string): string | undefined {
  try {
    for (const line of readFileSync(`${ROOT}\\${app}\\.env.local`, "utf8").split("\n")) {
      const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* absent */
  }
  return undefined;
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function canConnect(url: string): Promise<{ ok: boolean; error?: string }> {
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    await client.end();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message.slice(0, 90) };
  }
}

function repoint(url: string, database: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
}

async function main() {
  const apps = [
    { name: "HRMS.circuvent", own: "hrms", foreign: "neondb" },
    { name: "Auth.circuvent", own: "neondb", foreign: "hrms" },
  ];

  console.log("");

  for (const app of apps) {
    const url = urlOf(app.name);
    if (!url) {
      console.log(`  (${app.name} has no DATABASE_URL)`);
      continue;
    }

    const own = await canConnect(url);
    check(`${app.name} can open its own database (${app.own})`, own.ok, own.error);

    const foreign = await canConnect(repoint(url, app.foreign));
    check(
      `${app.name} cannot open ${app.foreign}`,
      !foreign.ok,
      foreign.ok ? "the connection succeeded" : ""
    );
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.log("ERROR:", (e as Error).message.slice(0, 300));
  process.exitCode = 1;
});

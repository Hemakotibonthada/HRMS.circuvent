// Which Circuvent app connects to which database, as which role.
//
// The Neon project holds one schema per app and one shared `identity` schema.
// A role with BYPASSRLS in any one of them can read every tenant's rows in all
// of them, so the question has to be asked per application rather than per
// repository.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = "C:\\Users\\v-hbonthada\\WorkSpace-Pract\\Office Apps\\Office Apps";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* absent */
  }
  return out;
}

/** Everything about a connection string except the secret. */
function describe(url: string): { role: string; host: string; database: string } | null {
  const match = /^postgres(?:ql)?:\/\/([^:]+):[^@]*@([^/]+)\/([^?]+)/.exec(url);
  if (!match) return null;
  return { role: match[1], host: match[2], database: match[3] };
}

interface AppRow {
  app: string;
  role: string;
  host: string;
  database: string;
  bypasses?: boolean;
  note?: string;
}

async function main() {
  const apps = readdirSync(ROOT).filter((name) =>
    existsSync(join(ROOT, name, "package.json"))
  );

  const rows: AppRow[] = [];
  const checked = new Map<string, boolean>();

  for (const app of apps) {
    const envFiles = [".env.local", ".env", ".env.production"].map((f) => join(ROOT, app, f));
    let url: string | undefined;

    for (const file of envFiles) {
      const env = loadEnv(file);
      if (env.DATABASE_URL) {
        url = env.DATABASE_URL;
        break;
      }
    }

    if (!url) {
      rows.push({ app, role: "-", host: "-", database: "-", note: "no DATABASE_URL" });
      continue;
    }

    const parts = describe(url);
    if (!parts) {
      rows.push({ app, role: "?", host: "?", database: "?", note: "unparseable URL" });
      continue;
    }

    // One connection per distinct role+host, not per app.
    const key = `${parts.role}@${parts.host}`;
    if (!checked.has(key)) {
      try {
        const client = new pg.Client({
          connectionString: url,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 15_000,
        });
        await client.connect();
        const r = await client.query<{ b: boolean }>(
          `select rolbypassrls as b from pg_roles where rolname = current_user`
        );
        checked.set(key, r.rows[0]?.b === true);
        await client.end();
      } catch (error) {
        rows.push({
          ...parts,
          app,
          note: `could not connect: ${(error as Error).message.slice(0, 60)}`,
        });
        continue;
      }
    }

    rows.push({ app, ...parts, bypasses: checked.get(key) });
  }

  console.log("");
  console.log(
    "app".padEnd(22) + "role".padEnd(18) + "database".padEnd(14) + "isolates tenants?"
  );
  console.log("-".repeat(78));

  for (const r of rows) {
    const verdict =
      r.note !== undefined
        ? r.note
        : r.bypasses
          ? "NO — BYPASSRLS, every policy inert"
          : "yes";
    console.log(
      r.app.padEnd(22) + r.role.padEnd(18) + r.database.padEnd(14) + verdict
    );
  }

  const leaking = rows.filter((r) => r.bypasses);
  console.log("");
  console.log(
    `${leaking.length} of ${rows.filter((r) => r.bypasses !== undefined).length} connected apps run without tenant isolation.`
  );
  console.log("");
}

main().catch((e) => console.log("ERROR:", (e as Error).message.slice(0, 300)));

// @vitest-environment node
//
// No route handler in this codebase has a test harness anywhere yet —
// exercising one for real means constructing a NextRequest, an auth cookie,
// and a live-or-mocked DB connection just to prove a 403 branch runs first,
// which is a lot of scaffolding for what is actually a one-line property:
// "this handler checks the permission before it does anything else." That
// property is checked here the same way document-templates.test.ts already
// proves this repository never imports generatedDocuments — by reading the
// file's own source and asserting on what it imports and calls, not by
// guessing from prose comments.
//
// The concrete failure this rules out: someone adds a DELETE handler to one
// of these files next quarter, copies the surrounding boilerplate but not
// the permission check, and every non-HR employee in the org can suddenly
// reach a template endpoint nothing meant to expose to them. A count
// mismatch between "how many HTTP methods this file exports" and "how many
// times it checks templates.manage" catches that on the next test run
// instead of in a production incident report.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_DIR = join(process.cwd(), "src", "app", "api", "document-templates");

/** Every route file this feature owns, and the HTTP methods it exports —
 * kept as an explicit list rather than discovered by globbing the directory,
 * so that adding a new route file without adding it here is itself a visible
 * gap in the test rather than something that silently passes by omission. */
const ROUTE_FILES: { path: string[]; methods: string[] }[] = [
  { path: ["route.ts"], methods: ["GET"] },
  { path: ["[id]", "route.ts"], methods: ["GET", "PATCH"] },
  { path: ["[id]", "versions", "route.ts"], methods: ["GET"] },
  { path: ["[id]", "revert", "route.ts"], methods: ["POST"] },
  { path: ["[id]", "preview", "route.ts"], methods: ["POST"] },
];

describe("document-templates API routes are role-gated on templates.manage", () => {
  for (const { path, methods } of ROUTE_FILES) {
    const label = path.join("/");

    it(`${label} imports roleHasPermission from the real rbac module, not a local stand-in`, () => {
      const source = readFileSync(join(ROUTE_DIR, ...path), "utf8");
      // A locally redefined `function roleHasPermission` would satisfy every
      // other assertion below while checking nothing real — this pins the
      // check to the one implementation rbac.test.ts actually verifies.
      expect(source).toMatch(/import\s*\{[^}]*\broleHasPermission\b[^}]*\}\s*from\s*"@\/lib\/rbac"/);
    });

    it(`${label} checks templates.manage exactly once per exported HTTP method (${methods.join(", ")})`, () => {
      const source = readFileSync(join(ROUTE_DIR, ...path), "utf8");

      for (const method of methods) {
        expect(source).toMatch(new RegExp(`export async function ${method}\\b`));
      }

      // Counting occurrences — not just "at least one" — is what catches a
      // second exported method that forgot to bring its own guard along;
      // "at least one" would stay green even if only the first of two
      // handlers in a file were ever protected.
      const guardMatches = source.match(/roleHasPermission\(ctx\.role,\s*"templates\.manage"\)/g) ?? [];
      expect(guardMatches.length).toBe(methods.length);
    });

    it(`${label} checks the permission before constructing the repository, in every method`, () => {
      const source = readFileSync(join(ROUTE_DIR, ...path), "utf8");
      const bodies =
        methods.length === 1
          ? [source]
          : // Two-method files (only [id]/route.ts today) are split on the
            // second export so each handler's ordering is checked on its own
            // slice — otherwise an early guard in GET could hide a missing
            // or misplaced one in PATCH.
            splitOnSecondExport(source);

      for (const body of bodies) {
        const guardIndex = body.indexOf('roleHasPermission(ctx.role, "templates.manage")');
        const repoIndex = body.indexOf("NeonDocumentTemplatesRepository(ctx)");
        expect(guardIndex).toBeGreaterThan(-1);
        // repoIndex of -1 (versions/route.ts style helpers aside, every file
        // here does construct the repository) would make this comparison
        // meaningless, so it is asserted explicitly rather than silently
        // passing via "-1 < guardIndex".
        expect(repoIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeLessThan(repoIndex);
      }
    });
  }
});

function splitOnSecondExport(source: string): string[] {
  const marker = "export async function PATCH(";
  const splitPoint = source.indexOf(marker);
  if (splitPoint === -1) return [source];
  return [source.slice(0, splitPoint), source.slice(splitPoint)];
}

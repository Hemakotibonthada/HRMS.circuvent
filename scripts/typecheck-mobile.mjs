// ═══════════════════════════════════════════════════════════════
// TYPECHECK THE MOBILE APP
// ═══════════════════════════════════════════════════════════════
// The Expo app is a separate package with its own tsconfig, its own React
// Native types and `noUncheckedIndexedAccess` turned on. The root `tsc` run
// excludes it, so without this it would never be compiled by `npm run verify`
// and would rot quietly — which is how the API client came to have a sign-in
// method that could not have worked.
//
// Skips with a message rather than failing when mobile/node_modules is absent.
// A developer working only on the web app should not have to install React
// Native to run the test suite, and a hard failure there teaches people to
// stop running verify.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = join(repoRoot, "mobile");

if (!existsSync(join(mobileRoot, "node_modules"))) {
  console.log(
    "mobile: dependencies not installed, skipping typecheck. " +
      "Run `npm install` in mobile/ to include it."
  );
  process.exit(0);
}

// Shell mode on Windows: npx is a .cmd shim, and spawnSync refuses to execute
// one directly (EINVAL) unless it goes through the shell. The arguments here
// are constants, so there is nothing injectable to worry about.
const result = spawnSync("npx tsc --noEmit", {
  cwd: mobileRoot,
  stdio: "inherit",
  shell: true,
});

if (result.error) {
  console.error("mobile: could not run tsc —", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

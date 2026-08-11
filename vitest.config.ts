import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // mobile/ holds the Expo app. Only its pure modules (theme, formatting,
    // queue policy) are picked up here — anything importing react-native or
    // expo-* lives behind an adapter and is covered by the mobile package's
    // own runner. Including them here means `npm run verify` fails when the
    // palette drops below AA, rather than the check living in a second
    // command nobody remembers to run.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
      "mobile/src/**/*.{test,spec}.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/db/**"],
      // The payroll engine, RBAC and tenant scoping are the code paths where a
      // silent bug costs real money or leaks another company's data.
      thresholds: {
        "src/lib/payroll-engine.ts": { statements: 80, branches: 70, functions: 80, lines: 80 },
        "src/lib/rbac.ts": { statements: 90, branches: 80, functions: 90, lines: 90 },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The Expo app imports the platform-neutral core through this alias.
      // Declared here as well so mobile/ tests resolve it the same way metro
      // and the mobile tsconfig do — three places, and they have to agree.
      "@shared": fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
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
    },
  },
});

// Next.js 16's eslint-config-next ships native flat configs. Loading them
// through FlatCompat routed them back through the legacy eslintrc validator,
// which throws "Converting circular structure to JSON" on
// eslint-plugin-react-hooks 7. Importing the flat configs directly avoids the
// legacy path entirely.

import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // .firebase and .vercel hold deploy staging output — a full bundled copy
    // of .next — which accounts for ~1,200 spurious errors when linted.
    ignores: [
      ".next/**",
      ".firebase/**",
      ".vercel/**",
      "out/**",
      "build/**",
      "drizzle/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // The existing 52k LOC predates these rules and trips them ~45,000
      // times. Failing the build on day one would just get `verify` disabled,
      // so they warn here and are hard errors on new code below. Burning down
      // the backlog is Phase 2 (see docs/ROADMAP.md §2.4).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["warn", "smart"],
      "prefer-const": "warn",
    },
  },
  {
    // New code has no backlog, so it is held to the target standard.
    files: [
      "src/db/**/*.ts",
      "src/lib/firebase-env.ts",
      "src/lib/api-context.ts",
      "src/app/api/employees/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },
  {
    // Scripts and tests run under a developer's eye, where console output is
    // the intended interface.
    files: ["scripts/**/*.ts", "**/*.test.{ts,tsx}", "vitest.setup.ts"],
    rules: { "no-console": "off" },
  },
];

export default eslintConfig;

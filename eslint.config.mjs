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
      "src/lib/auth/**/*.ts",
      "src/lib/workflow/**/*.ts",
      "src/lib/notifications/**/*.ts",
      "src/lib/reporting/**/*.ts",
      "src/lib/intelligence/**/*.ts",
      "src/lib/mobile/**/*.ts",
      "src/lib/api-keys.ts",
      "src/lib/api-v1-context.ts",
      "src/lib/firebase-env.ts",
      "src/lib/api-context.ts",
      "src/hooks/use-now.ts",
      "src/middleware.ts",
      "src/app/api/v1/**/*.ts",
      "src/app/api/employees/**/*.ts",
      "src/app/api/leave/**/*.ts",
      "src/app/api/attendance/**/*.ts",
      "src/app/api/payroll/**/*.ts",
      "src/app/api/reports/**/*.ts",
      "src/app/api/workflows/**/*.ts",
      "src/app/api/referrals/**/*.ts",
      "src/lib/referral-rules.ts",
      "src/lib/benefits-rules.ts",
      "src/app/api/benefits/**/*.ts",
      "src/lib/rostering.ts",
      "src/app/api/roster/**/*.ts",
      "src/lib/learning-rules.ts",
      "src/app/api/learning/**/*.ts",
      "src/lib/document-rules.ts",
      "src/app/api/documents/**/*.ts",
      "src/app/api/sign/**/*.ts",
      "src/lib/custom-fields.ts",
      "src/app/api/custom-fields/**/*.ts",
      "src/lib/governance.ts",
      "src/app/api/governance/**/*.ts",
      "src/lib/scim.ts",
      "src/lib/sso.ts",
      "src/app/api/scim/**/*.ts",
      "src/lib/compensation.ts",
      "src/app/api/compensation/**/*.ts",
      "src/lib/sla.ts",
      "src/app/api/helpdesk/**/*.ts",
      "src/lib/assets.ts",
      "src/lib/statutory-india.ts",
      "src/lib/performance.ts",
      "src/app/api/performance/**/*.ts",
      "src/app/api/assets/**/*.ts",
      "src/app/api/auth/{login,refresh,logout,me}/**/*.ts",
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

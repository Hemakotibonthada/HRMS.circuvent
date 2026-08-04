import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Both schemas are managed from this repo; identity is shared with the other
  // Circuvent apps, which read it but do not migrate it.
  schemaFilter: ["identity", "hrms"],
  casing: "snake_case",
  verbose: true,
  strict: true,
});

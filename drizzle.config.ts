import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env file");
}

export default defineConfig({
  schema: [
    "./src/db/schema.ts",
    "./src/db/applianceSchema.ts",
    "./src/db/publicSchema.ts",
  ],
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  //schemaFilter: [process.env.DB_SCHEMA ?? "public"],
  verbose: true,
  strict: true,
});

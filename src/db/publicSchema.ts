import {
  pgTable,
  boolean,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Same table as the backend's src/db/publicSchema.ts -- deliberately NOT
// inside any pgSchema() wrapper. Lives in Postgres's actual `public`
// schema, the one registry every deployment can always see regardless of
// search_path, and is what tells CMS login which tenant schema to use.
//
// adminName/adminEmail/adminPasswordHash: signup no longer creates the
// tenant schema or the first admin user itself -- it only registers the
// company here. These columns hold the intended admin account until
// whatever process actually provisions the schema (manual SQL, a
// separate internal tool, etc.) seeds that schema's users table from
// them. isProvisioned tracks whether that's happened yet.
export const organizations = pgTable(
  "organizations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    schemaName: text("schema_name").notNull(),
    phoneNumber: varchar("phone_number", { length: 50 }),
    email: varchar("email", { length: 255 }),
    officeAddress: text("office_address"),
    adminName: varchar("admin_name", { length: 255 }),
    adminEmail: varchar("admin_email", { length: 255 }),
    adminPasswordHash: text("admin_password_hash"),
    isProvisioned: boolean("is_provisioned").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false })
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("organizations_schema_name_key").on(table.schemaName),
  ],
);
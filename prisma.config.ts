import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  (process.env.DATABASE_PATH ? `file:${process.env.DATABASE_PATH}` : undefined) ??
  process.env.DATABASE_URL ??
  "file:./prisma/dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});

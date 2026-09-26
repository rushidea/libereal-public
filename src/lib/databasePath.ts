import { resolve } from "path";

const defaultDatabasePath = () => resolve(process.cwd(), "prisma/dev.db");

export function getDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  if (process.env.NODE_ENV === "production") {
    // `next build` evaluates server modules; allow the local default DB path.
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return defaultDatabasePath();
    }
    throw new Error("DATABASE_PATH must be set in production.");
  }

  return defaultDatabasePath();
}

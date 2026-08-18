import { PrismaClient } from "@prisma/client";

/**
 * Standard Next.js-safe Prisma singleton — avoids exhausting DB connections
 * from hot-reload creating a new PrismaClient on every file change in dev.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

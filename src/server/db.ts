import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Cliente Prisma único por instancia. En desarrollo se reutiliza entre recargas en caliente
 * para no agotar conexiones. En Vercel usa la cadena de conexión con pooling (DATABASE_URL).
 */
function createClient() {
  // No se lanza error aquí para no romper la compilación sin base de datos;
  // la primera consulta fallará y /api/health lo reportará.
  const connectionString = process.env.DATABASE_URL ?? "";
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

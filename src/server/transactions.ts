import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * Ejecuta una operación con transacción serializable y la reintenta si Postgres la aborta por
 * conflicto de serialización (P2034). Con peticiones simultáneas, Postgres puede abortar una de
 * ellas aunque toquen datos de usuarios distintos; reintentar es la forma correcta de manejarlo.
 */
export async function withSerializableRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await operation();
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!conflict || i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 15 * i + Math.floor(Math.random() * 20)));
    }
  }
}

import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { logServerError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Comprobación de salud: verifica que la aplicación responde y que la base de datos es accesible. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", latencyMs: Date.now() - startedAt });
  } catch (error) {
    logServerError("health", error);
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}

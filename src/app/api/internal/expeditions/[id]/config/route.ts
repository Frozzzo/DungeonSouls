import { NextResponse } from "next/server";
import { expeditionIdSchema } from "@/lib/validation/expedition";
import { logServerError } from "@/server/errors";
import { getRoomConfig } from "@/server/expeditions/service";
import { verifyInternalRequest } from "@/server/realtime/internal-auth";

export const dynamic = "force-dynamic";

/** Configuración de la sala (jugadores con sus estadísticas calculadas aquí). Solo para el servidor de partida. */
export async function GET(request: Request, { params }: RouteContext<"/api/internal/expeditions/[id]/config">) {
  const auth = await verifyInternalRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = expeditionIdSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const config = await getRoomConfig(id.data);
    if (!config) return NextResponse.json({ error: "not_active" }, { status: 404 });
    return NextResponse.json(config, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logServerError("roomConfig", error);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

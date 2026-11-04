import { NextResponse } from "next/server";
import { expeditionResultSchema } from "@/lib/validation/expedition";
import { logServerError } from "@/server/errors";
import { applyExpeditionResult } from "@/server/expeditions/service";
import { verifyInternalRequest } from "@/server/realtime/internal-auth";

export const dynamic = "force-dynamic";

/**
 * Resultado de una expedición, enviado y firmado por el servidor de partida. Idempotente: el
 * servidor de partida lo reintenta hasta recibir 200 y repetirlo no concede nada más.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/internal/expeditions/[id]/results">) {
  const auth = await verifyInternalRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let json: unknown;
  try {
    json = JSON.parse(auth.body);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = expeditionResultSchema.safeParse(json);
  if (!parsed.success || parsed.data.expeditionId !== (await params).id) return NextResponse.json({ error: "invalid_result" }, { status: 400 });
  try {
    const applied = await applyExpeditionResult(parsed.data);
    // NOT_FOUND también responde 200: no tiene sentido que el servidor de partida lo reintente.
    return NextResponse.json(applied);
  } catch (error) {
    logServerError("applyExpeditionResult", error);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

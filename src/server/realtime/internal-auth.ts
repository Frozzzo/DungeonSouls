import "server-only";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from "@/realtime/signing";
import { realtimeConfig } from "./config";

/** Tamaño máximo del cuerpo de una petición interna (un resultado ocupa ~1 KB). */
const MAX_BODY_BYTES = 16 * 1024;

export type InternalRequest = { ok: true; body: string } | { ok: false; status: 401 | 404 | 413; error: string };

/**
 * Verifica que una petición viene del servidor de partida: firma HMAC sobre método, ruta,
 * momento y cuerpo, con un desfase máximo de 60 s.
 */
export async function verifyInternalRequest(request: Request): Promise<InternalRequest> {
  const realtime = realtimeConfig();
  if (!realtime) return { ok: false, status: 404, error: "not_configured" };
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "too_large" };
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "too_large" };
  const valid = await verifyRequest(realtime.secret, {
    method: request.method,
    path: new URL(request.url).pathname,
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  return valid ? { ok: true, body } : { ok: false, status: 401, error: "bad_signature" };
}

/**
 * Firmas HMAC-SHA256 compartidas entre Vercel y el servidor de partida (Cloudflare).
 *
 * - Tickets de conexión: Vercel los emite (válidos 60 s) y el Worker los verifica antes de dejar
 *   entrar a nadie en una sala.
 * - Peticiones internas: el servidor de partida firma las llamadas a Vercel (configuración de la
 *   sala y resultado) y Vercel las verifica.
 *
 * Solo usa Web Crypto (`crypto.subtle`), disponible igual en Node 22, Vercel y Workers. Cada uso
 * firma con un prefijo distinto, así una firma de un tipo nunca vale para el otro.
 */

export const TICKET_TTL_SECONDS = 60;
/** Desfase máximo admitido entre relojes para las peticiones firmadas. */
export const REQUEST_MAX_SKEW_SECONDS = 60;
/** Longitud mínima del secreto compartido. */
export const MIN_SECRET_LENGTH = 32;

export const SIGNATURE_HEADER = "x-ds-signature";
export const TIMESTAMP_HEADER = "x-ds-timestamp";

export interface TicketPayload {
  v: 1;
  /** Expedición. */
  e: string;
  /** Usuario. */
  u: string;
  /** Personaje (= id del jugador en la simulación). */
  c: string;
  /** Nonce aleatorio: la sala no acepta el mismo ticket dos veces. */
  n: string;
  /** Emitido y caduca (segundos Unix). */
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, key);
  }
  return key;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sign(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

/** Comparación en tiempo constante (la hace Web Crypto). */
async function verify(secret: string, message: string, signature: string): Promise<boolean> {
  const bytes = base64UrlDecode(signature);
  if (!bytes || bytes.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes as Uint8Array<ArrayBuffer>, encoder.encode(message));
}

export function assertSecret(secret: string | undefined): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error(`REALTIME_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres.`);
  return secret;
}

export function randomNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

// ---------------------------------------------------------------- Tickets

export async function createTicket(secret: string, data: { expeditionId: string; userId: string; characterId: string }, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload: TicketPayload = { v: 1, e: data.expeditionId, u: data.userId, c: data.characterId, n: randomNonce(), iat: nowSeconds, exp: nowSeconds + TICKET_TTL_SECONDS };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await sign(secret, `ticket.${body}`)}`;
}

export type TicketCheck = { ok: true; payload: TicketPayload } | { ok: false; reason: "MALFORMED" | "SIGNATURE" | "EXPIRED" | "WRONG_EXPEDITION" };

/** Verifica firma, caducidad y expedición. El nonce lo comprueba la sala (recuerda los usados). */
export async function verifyTicket(secret: string, token: string, expeditionId: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<TicketCheck> {
  if (typeof token !== "string" || token.length > 1024) return { ok: false, reason: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "MALFORMED" };
  const [body, signature] = parts;
  if (!(await verify(secret, `ticket.${body}`, signature))) return { ok: false, reason: "SIGNATURE" };
  const bytes = base64UrlDecode(body);
  if (!bytes) return { ok: false, reason: "MALFORMED" };
  let payload: TicketPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as TicketPayload;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (payload.v !== 1 || typeof payload.e !== "string" || typeof payload.c !== "string" || typeof payload.u !== "string" || typeof payload.n !== "string") {
    return { ok: false, reason: "MALFORMED" };
  }
  if (typeof payload.exp !== "number" || nowSeconds > payload.exp || payload.iat > nowSeconds + REQUEST_MAX_SKEW_SECONDS) return { ok: false, reason: "EXPIRED" };
  if (payload.e !== expeditionId) return { ok: false, reason: "WRONG_EXPEDITION" };
  return { ok: true, payload };
}

// ---------------------------------------------------------------- Peticiones internas

function requestMessage(method: string, path: string, timestamp: string, body: string): string {
  return `request.${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`;
}

/** Cabeceras de una petición firmada. `path` es la ruta sin dominio ni consulta (/api/internal/...). */
export async function signRequest(secret: string, method: string, path: string, body = "", nowSeconds = Math.floor(Date.now() / 1000)): Promise<Record<string, string>> {
  const timestamp = String(nowSeconds);
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: await sign(secret, requestMessage(method, path, timestamp, body)) };
}

export async function verifyRequest(
  secret: string,
  req: { method: string; path: string; body: string; timestamp: string | null; signature: string | null },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!req.timestamp || !req.signature || !/^\d{1,12}$/.test(req.timestamp)) return false;
  if (Math.abs(nowSeconds - Number(req.timestamp)) > REQUEST_MAX_SKEW_SECONDS) return false;
  return verify(secret, requestMessage(req.method, req.path, req.timestamp, req.body), req.signature);
}

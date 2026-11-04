import "server-only";
import { MIN_SECRET_LENGTH } from "@/realtime/signing";

/**
 * Configuración del servidor de partida (Cloudflare). Sin ella el juego en grupo se desactiva,
 * pero el resto de la aplicación funciona igual.
 *
 * - REALTIME_SECRET: secreto compartido con el Worker (mín. 32 caracteres). Solo en el servidor.
 * - REALTIME_URL: URL pública del Worker (wss://… o ws://localhost:8787 en local).
 */
export function realtimeConfig(): { secret: string; url: string } | null {
  const secret = process.env.REALTIME_SECRET;
  const url = process.env.REALTIME_URL;
  if (!secret || secret.length < MIN_SECRET_LENGTH || !url || !/^wss?:\/\//.test(url)) return null;
  return { secret, url: url.replace(/\/+$/, "") };
}

export const isRealtimeConfigured = () => realtimeConfig() !== null;

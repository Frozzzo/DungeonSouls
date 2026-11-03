import { type NextRequest, NextResponse } from "next/server";

/**
 * Comprobación optimista: si no hay cookie de sesión, redirige al login antes de renderizar.
 * La verificación real (token en base de datos y propiedad de recursos) se hace siempre
 * en el servidor, en cada página y Server Action (src/server/auth/current-user.ts).
 */
const SESSION_COOKIE = "ds_session";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/characters/:path*"],
};

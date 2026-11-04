import { NextResponse } from "next/server";
import { expeditionIdSchema } from "@/lib/validation/expedition";
import { getCurrentUser } from "@/server/auth/current-user";
import { DomainError, logServerError } from "@/server/errors";
import { issueTicket } from "@/server/expeditions/service";

export const dynamic = "force-dynamic";

/** Ticket de conexión a la sala (firmado, 60 s). Requiere sesión y participar en la expedición. */
export async function POST(_request: Request, { params }: RouteContext<"/api/expeditions/[id]/ticket">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = expeditionIdSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const ticket = await issueTicket(user.id, id.data);
    return NextResponse.json(ticket, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 409 });
    logServerError("issueTicket", error);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/current-user";

export default async function GameLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <header className="border-b border-abyss-700 bg-abyss-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Logo />
          <nav className="flex items-center gap-3 text-sm" aria-label="Principal">
            {/* En móvil se omite (el logotipo lleva al inicio): así la cabecera cabe en 360 px. */}
            <Link href="/characters" className="hidden text-bone-300 hover:text-bone-100 sm:inline">
              Personajes
            </Link>
            <Link href="/party" className="text-bone-300 hover:text-bone-100" data-testid="nav-party">
              Grupo
            </Link>
            <span className="hidden text-bone-300 sm:inline" data-testid="current-user">
              {user.username}
            </span>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" className="px-3">
                Cerrar sesión
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}

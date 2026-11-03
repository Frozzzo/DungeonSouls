import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/current-user";

export default async function GameLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <header className="border-b border-abyss-700 bg-abyss-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-bone-300 sm:inline" data-testid="current-user">
              {user.username}
            </span>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost">
                Cerrar sesión
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}

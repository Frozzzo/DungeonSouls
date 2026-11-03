import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { ClassEmblem } from "@/components/character/class-emblem";
import { Logo } from "@/components/layout/logo";
import { siteConfig } from "@/config/site";
import { CLASS_LIST } from "@/game/classes/definitions";
import { getCurrentUser } from "@/server/auth/current-user";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-16 sm:py-24">
      <Logo size="lg" />
      <p className="mt-4 max-w-xl text-center text-bone-300">{siteConfig.tagline}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {user ? (
          <Link href="/characters" className={buttonStyles("primary")}>
            Continuar como {user.username}
          </Link>
        ) : (
          <>
            <Link href="/register" className={buttonStyles("primary")}>
              Crear cuenta
            </Link>
            <Link href="/login" className={buttonStyles("secondary")}>
              Iniciar sesión
            </Link>
          </>
        )}
      </div>
      <div className="rune-divider my-14 w-full max-w-3xl" />
      <section className="grid w-full max-w-5xl gap-4 md:grid-cols-3">
        {CLASS_LIST.map((def) => (
          <article key={def.id} className="panel rounded-lg p-5">
            <div className="flex items-center gap-3" style={{ color: def.accent }}>
              <ClassEmblem classId={def.id} />
              <div>
                <h2 className="font-display text-lg text-bone-100">{def.name}</h2>
                <p className="text-xs uppercase tracking-widest">{def.role}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-bone-300">{def.summary}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

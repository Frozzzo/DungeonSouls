import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="font-display text-4xl">Aquí solo hay oscuridad</h1>
      <p className="text-bone-300">Lo que buscas no existe o no te pertenece.</p>
      <Link href="/" className={buttonStyles("secondary")}>
        Volver al inicio
      </Link>
    </main>
  );
}

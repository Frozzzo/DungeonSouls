import type { Metadata } from "next";
import Link from "next/link";
import { CreateCharacterForm } from "@/components/character/create-character-form";
import { BALANCE } from "@/game/balance";

export const metadata: Metadata = { title: "Nuevo personaje" };

export default function NewCharacterPage() {
  return (
    <div className="space-y-6">
      <Link href="/characters" className="text-sm text-bone-300 hover:text-bone-100">
        ← Volver a personajes
      </Link>
      <div>
        <h1 className="font-display text-3xl">Nuevo personaje</h1>
        <p className="text-sm text-bone-300">
          Empiezas en el nivel 1 con {BALANCE.progression.startingStatPoints} puntos de atributo libres.
        </p>
      </div>
      <CreateCharacterForm />
    </div>
  );
}

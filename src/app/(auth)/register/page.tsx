import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { getCurrentUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/characters");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl">Crear cuenta</h1>
      <RegisterForm />
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/characters");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl">Iniciar sesión</h1>
      <LoginForm />
    </>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/validation/form";

export function LoginForm() {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Correo" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} errors={state.fieldErrors?.email} />
      <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required errors={state.fieldErrors?.password} />
      {state.message ? <Alert>{state.message}</Alert> : null}
      <SubmitButton className="w-full" pendingText="Entrando…">
        Entrar
      </SubmitButton>
      <p className="text-center text-sm text-bone-300">
        ¿No tienes cuenta?{" "}
        <Link href="/register" className="text-ember-400 hover:underline">
          Regístrate
        </Link>
      </p>
    </form>
  );
}

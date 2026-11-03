"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/validation/form";

export function RegisterForm() {
  const [state, formAction] = useActionState<FormState, FormData>(registerAction, {});
  const e = state.fieldErrors;
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Correo" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} errors={e?.email} />
      <Field
        label="Nombre de usuario"
        name="username"
        autoComplete="username"
        required
        defaultValue={state.values?.username}
        errors={e?.username}
        hint="3–20 caracteres: letras, números y guion bajo."
      />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        errors={e?.password}
        hint="Mínimo 10 caracteres."
      />
      <Field label="Repite la contraseña" name="confirmPassword" type="password" autoComplete="new-password" required errors={e?.confirmPassword} />
      {state.message ? <Alert>{state.message}</Alert> : null}
      <SubmitButton className="w-full" pendingText="Creando cuenta…">
        Crear cuenta
      </SubmitButton>
      <p className="text-center text-sm text-bone-300">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-ember-400 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}

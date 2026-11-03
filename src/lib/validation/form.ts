import type { z } from "zod";

/** Estado devuelto por las Server Actions a los formularios (useActionState). */
export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Valores a reinyectar en el formulario tras un error (nunca contraseñas). */
  values?: Record<string, string>;
}

export function fieldErrorsFrom(error: z.ZodError): FormState["fieldErrors"] {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

"use server";

import { redirect } from "next/navigation";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { type FormState, fieldErrorsFrom } from "@/lib/validation/form";
import {
  clearSessionCookie,
  getClientIp,
  getSessionToken,
  setSessionCookie,
} from "@/server/auth/current-user";
import { authenticateUser, registerUser } from "@/server/auth/service";
import { createSession, invalidateSessionToken } from "@/server/auth/sessions";
import { DomainError, logServerError } from "@/server/errors";

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo en unos segundos.";

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    username: String(formData.get("username") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };
  const values = { email: raw.email, username: raw.username };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  try {
    const { userId } = await registerUser(parsed.data, await getClientIp());
    const { token, expiresAt } = await createSession(userId);
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message, values };
    logServerError("register", error);
    return { message: GENERIC_ERROR, values };
  }
  redirect("/characters");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
  const values = { email: raw.email };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  try {
    const { userId } = await authenticateUser(parsed.data, await getClientIp());
    const { token, expiresAt } = await createSession(userId);
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message, values };
    logServerError("login", error);
    return { message: GENERIC_ERROR, values };
  }
  redirect("/characters");
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    try {
      await invalidateSessionToken(token);
    } catch (error) {
      logServerError("logout", error);
    }
  }
  await clearSessionCookie();
  redirect("/login");
}

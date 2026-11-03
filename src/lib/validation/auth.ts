import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El correo es demasiado largo")
  .pipe(z.email("Introduce un correo válido"));

export const passwordSchema = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .max(128, "La contraseña no puede superar 128 caracteres");

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "El nombre de usuario debe tener al menos 3 caracteres")
  .max(20, "El nombre de usuario no puede superar 20 caracteres")
  .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y guion bajo");

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Introduce tu contraseña").max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

import { db } from "@/server/db";

export async function resetDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Character", "Session", "AuthAttempt", "User" RESTART IDENTITY CASCADE');
}

let counter = 0;
export function uniqueUser(prefix = "hero") {
  counter += 1;
  const id = `${prefix}${Date.now().toString(36)}${counter}`;
  return {
    email: `${id}@example.test`,
    username: id.slice(0, 20),
    password: "una-contraseña-segura",
    confirmPassword: "una-contraseña-segura",
  };
}

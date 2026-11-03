import { execSync } from "node:child_process";

/**
 * Prepara la base de datos de pruebas aplicando las migraciones.
 * Requiere DATABASE_URL apuntando a una base de datos desechable (nunca producción).
 */
export default function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Las pruebas de integración requieren DATABASE_URL (base de datos de pruebas).");
  if (!/test/i.test(url) && process.env.ALLOW_NON_TEST_DB !== "1") {
    throw new Error("Por seguridad, DATABASE_URL de integración debe contener 'test' en su nombre.");
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}

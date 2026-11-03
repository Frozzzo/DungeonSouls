import { expect, type Page, test } from "@playwright/test";

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function registerWithCharacter(page: Page, className: string) {
  const id = uid();
  await page.context().setExtraHTTPHeaders({ "x-real-ip": randomIp() });
  await page.goto("/register");
  await page.getByLabel("Correo").fill(`e2e_${id}@example.test`);
  await page.getByLabel("Nombre de usuario").fill(`e2e_${id}`.slice(0, 20));
  await page.getByLabel("Contraseña", { exact: true }).fill("contraseña-e2e-segura");
  await page.getByLabel("Repite la contraseña").fill("contraseña-e2e-segura");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/characters$/);
  await page.getByRole("link", { name: "Crear personaje" }).click();
  const name = `Hero${uid().slice(-6)}`;
  await page.getByLabel("Nombre").fill(name);
  await page.getByText(className, { exact: true }).click();
  await page.getByRole("button", { name: "Crear personaje" }).click();
  await expect(page.getByTestId("character-name")).toHaveText(name);
  return name;
}

test("la pantalla de combate se abre, se pausa y se puede abandonar", async ({ page }) => {
  await registerWithCharacter(page, "Guardián");
  await page.getByRole("button", { name: "Entrar al piso 1" }).click();
  await expect(page).toHaveURL(/\/runs\/[^/?]+$/);
  await expect(page.getByTestId("game-screen")).toBeVisible();
  await expect(page.getByTestId("hud-floor")).toHaveText("Piso 1");
  await page.getByTestId("start-floor").click();
  await page.getByRole("button", { name: "Pausa" }).click();
  await page.getByRole("button", { name: "Abandonar el piso" }).click();
  await expect(page).toHaveURL(/\/characters\/[^/]+$/);
  await expect(page.getByTestId("run-history")).toContainText("Abandonado");
});

/**
 * Completa un piso en el navegador. El piloto automático (solo existe en compilaciones con
 * NEXT_PUBLIC_E2E_AUTOPILOT=1) genera intenciones como lo haría el teclado; el servidor repite
 * la partida, concede la XP y el botín, y desbloquea el piso siguiente.
 */
test("flujo completo: crear personaje, completar el piso 1 y recibir recompensas validadas", async ({ page }) => {
  test.setTimeout(150_000);
  await registerWithCharacter(page, "Segador");
  await page.getByRole("button", { name: "Entrar al piso 1" }).click();
  await expect(page).toHaveURL(/\/runs\/[^/?]+$/);
  const runUrl = page.url();
  await page.goto(`${runUrl}?autopilot=1`);
  await expect(page.getByTestId("run-result-title")).toHaveText("Piso completado", { timeout: 120_000 });
  const xp = Number((await page.getByTestId("run-xp").innerText()).replace("+", ""));
  expect(xp).toBeGreaterThan(0);
  await expect(page.getByTestId("inventory-item").first()).toBeVisible();

  // Recargar el intento muestra el mismo resultado (no se concede otra vez).
  await page.goto(runUrl);
  await expect(page.getByTestId("run-xp")).toHaveText(`+${xp}`);

  await page.getByRole("link", { name: "Volver al personaje" }).click();
  await expect(page.getByTestId("highest-floor")).toContainText("1");
  await expect(page.getByRole("button", { name: "Entrar al piso 2" })).toBeVisible();
  await expect(page.getByTestId("run-history")).toContainText("Completado");

  await page.getByRole("link", { name: "Inventario" }).click();
  await expect(page.getByTestId("inventory-count")).not.toHaveText(/^0 /);
});

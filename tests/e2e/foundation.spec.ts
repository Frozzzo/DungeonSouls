import { expect, type Page, test } from "@playwright/test";

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function register(page: Page) {
  const id = uid();
  const account = { email: `e2e_${id}@example.test`, username: `e2e_${id}`.slice(0, 20), password: "contraseña-e2e-segura" };
  // Cada prueba simula una IP distinta para no chocar con el límite de registros por IP.
  await page.context().setExtraHTTPHeaders({ "x-real-ip": randomIp() });
  await page.goto("/register");
  await page.getByLabel("Correo").fill(account.email);
  await page.getByLabel("Nombre de usuario").fill(account.username);
  await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
  await page.getByLabel("Repite la contraseña").fill(account.password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/characters$/);
  return account;
}

test("la comprobación de salud responde", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", database: "ok" });
});

test("las rutas privadas redirigen al login sin sesión", async ({ page }) => {
  await page.goto("/characters");
  await expect(page).toHaveURL(/\/login$/);
});

test("flujo completo: registro, personaje, estadísticas, cierre e inicio de sesión", async ({ page }) => {
  const account = await register(page);
  await expect(page.getByText("El abismo espera a su primer héroe.")).toBeVisible();

  // Crear personaje
  await page.getByRole("link", { name: "Crear personaje" }).click();
  const name = `Heroe${uid().slice(-6)}`;
  await page.getByLabel("Nombre").fill(name);
  await page.getByText("Oráculo", { exact: true }).click();
  await page.getByRole("button", { name: "Crear personaje" }).click();

  await expect(page.getByTestId("character-name")).toHaveText(name);
  await expect(page.getByTestId("character-level")).toHaveText("Nivel 1");
  await expect(page.getByTestId("stat-points")).toHaveText("5");

  // Asignar puntos: 2 a Inteligencia, 1 a Vitalidad
  await page.getByRole("button", { name: "Añadir punto a Inteligencia" }).click();
  await page.getByRole("button", { name: "Añadir punto a Inteligencia" }).click();
  await page.getByRole("button", { name: "Añadir punto a Vitalidad" }).click();
  await expect(page.getByTestId("stat-points")).toHaveText("2");
  await page.getByRole("button", { name: "Confirmar asignación" }).click();
  await expect(page.getByText("Puntos asignados.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("stat-points")).toHaveText("2");

  // Cerrar sesión y volver a entrar: el personaje persiste
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Correo").fill(account.email);
  await page.getByLabel("Contraseña").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/characters$/);
  await expect(page.getByTestId("character-card")).toContainText(name);
});

test("credenciales incorrectas muestran un error genérico", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-real-ip": randomIp() });
  await page.goto("/login");
  await page.getByLabel("Correo").fill(`nadie_${uid()}@example.test`);
  await page.getByLabel("Contraseña").fill("lo-que-sea-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
});

test("no se puede ver el personaje de otro usuario", async ({ page, browser }) => {
  await register(page);
  await page.getByRole("link", { name: "Crear personaje" }).click();
  await page.getByLabel("Nombre").fill(`Ajeno${uid().slice(-6)}`);
  await page.getByText("Guardián", { exact: true }).click();
  await page.getByRole("button", { name: "Crear personaje" }).click();
  await expect(page.getByTestId("character-name")).toBeVisible();
  const url = page.url();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await register(otherPage);
  await otherPage.goto(url);
  await expect(otherPage.getByText("Aquí solo hay oscuridad")).toBeVisible();
  await other.close();
});

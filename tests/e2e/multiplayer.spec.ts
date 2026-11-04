import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * Juego en grupo de extremo a extremo: dos navegadores, el servidor de partida real (wrangler dev)
 * y Vercel aplicando las recompensas. Solo se ejecuta con E2E_REALTIME=1.
 */
test.skip(process.env.E2E_REALTIME !== "1", "Requiere el servidor de partida (E2E_REALTIME=1)");

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function newPlayer(browser: Browser, className: string): Promise<Page> {
  const context = await browser.newContext();
  await context.setExtraHTTPHeaders({ "x-real-ip": randomIp() });
  const page = await context.newPage();
  const id = uid();
  await page.goto("/register");
  await page.getByLabel("Correo").fill(`mp_${id}@example.test`);
  await page.getByLabel("Nombre de usuario").fill(`mp_${id}`.slice(0, 20));
  await page.getByLabel("Contraseña", { exact: true }).fill("contraseña-e2e-segura");
  await page.getByLabel("Repite la contraseña").fill("contraseña-e2e-segura");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/characters$/);
  await page.getByRole("link", { name: "Crear personaje" }).click();
  await page.getByLabel("Nombre").fill(`Mp${uid().slice(-6)}`);
  await page.getByText(className, { exact: true }).click();
  await page.getByRole("button", { name: "Crear personaje" }).click();
  await expect(page.getByTestId("character-name")).toBeVisible();
  return page;
}

test("dos jugadores forman un grupo, completan el piso 1 juntos y cada uno recibe su recompensa", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Basta con escritorio");
  test.setTimeout(180_000);
  const leader = await newPlayer(browser, "Guardián");
  const friend = await newPlayer(browser, "Segador");

  await leader.getByTestId("nav-party").click();
  await leader.getByRole("button", { name: "Crear grupo" }).click();
  const code = (await leader.getByTestId("party-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  await friend.goto(`/party?code=${code}`);
  await friend.getByRole("button", { name: "Unirse" }).click();
  await expect(friend.getByTestId("party-member")).toHaveCount(2);
  await friend.getByTestId("toggle-ready").getByRole("button").click();
  await expect(leader.getByTestId("party-member")).toHaveCount(2, { timeout: 10_000 });
  await expect(leader.getByText("Todos están listos.")).toBeVisible({ timeout: 10_000 });

  await leader.getByRole("button", { name: "Empezar expedición" }).click();
  await expect(leader).toHaveURL(/\/expeditions\/[^/?]+$/);
  // La sala de espera del otro jugador lo lleva a la expedición sola.
  await expect(friend).toHaveURL(/\/expeditions\/[^/?]+$/, { timeout: 15_000 });
  await expect(friend.getByTestId("hud-floor")).toContainText("Grupo de 2");
  await expect(friend.getByTestId("game-screen")).toHaveAttribute("data-online-phase", /waiting|playing/, { timeout: 15_000 });

  // Recargar con el piloto automático también prueba la reconexión (ticket nuevo + instantánea).
  const url = leader.url();
  await Promise.all([leader.goto(`${url}?autopilot=1`), friend.goto(`${url}?autopilot=1`)]);
  await expect(leader.getByTestId("hud-allies")).toBeVisible({ timeout: 15_000 });

  for (const page of [leader, friend]) {
    await expect(page.getByTestId("run-result-title")).toHaveText(/Piso completado/, { timeout: 150_000 });
    expect(Number((await page.getByTestId("run-xp").innerText()).replace("+", ""))).toBeGreaterThan(0);
  }

  // Ambos vuelven al grupo, que queda abierto para la siguiente expedición.
  await leader.getByRole("link", { name: "Volver al grupo" }).click();
  await expect(leader.getByRole("button", { name: "Empezar expedición" })).toBeVisible();
});

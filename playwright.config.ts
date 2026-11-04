import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
/**
 * Con E2E_REALTIME=1 también se arranca el servidor de partida (wrangler dev, en local) para las
 * pruebas del juego en grupo. Next.js necesita REALTIME_SECRET y REALTIME_URL con los mismos valores.
 */
const REALTIME = process.env.E2E_REALTIME === "1";
const REALTIME_PORT = Number(process.env.E2E_REALTIME_PORT ?? 8788);

/**
 * Pruebas de los flujos principales. Por defecto compilan y arrancan la app en modo producción
 * contra DATABASE_URL (usa una base de datos de pruebas).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `npm run start -- -p ${PORT}`,
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        ...(REALTIME
          ? [
              {
                command: `npm --prefix realtime run dev -- --port ${REALTIME_PORT} --var REALTIME_SECRET:${process.env.REALTIME_SECRET ?? ""} --var APP_URL:${baseURL} --var ALLOWED_ORIGINS:${baseURL}`,
                url: `http://localhost:${REALTIME_PORT}/health`,
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
              },
            ]
          : []),
      ],
});

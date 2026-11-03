import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` lanza error fuera de React Server Components; en pruebas se sustituye por un módulo vacío.
  "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // Comparten una base de datos: se ejecutan en serie.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});

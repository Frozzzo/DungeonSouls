import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Las migraciones prefieren la conexión directa; la app usa DATABASE_URL (con pooling).
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});

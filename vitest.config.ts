import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    globals: false,
    include: ["lib/**/__tests__/**/*.test.ts"],
    // Vitest doesn't auto-load .env.local like Next.js does. Mirror that here
    // so DATABASE_URL / ADMIN_DATABASE_URL / ENCRYPTION_KEY are available.
    env: loadEnv(mode || "test", process.cwd(), ""),
  },
}));

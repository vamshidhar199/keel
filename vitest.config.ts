import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    globals: false,
    include: ["lib/**/__tests__/**/*.test.ts"],
    // Some tests dynamically import heavy file-parser modules (pdf-parse,
    // mammoth, xlsx, csv-parse) on first call. Cold-start cost can exceed 5s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Vitest doesn't auto-load .env.local like Next.js does. Mirror that here
    // so DATABASE_URL / ADMIN_DATABASE_URL / ENCRYPTION_KEY are available.
    env: loadEnv(mode || "test", process.cwd(), ""),
  },
}));

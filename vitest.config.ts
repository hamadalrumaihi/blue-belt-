import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: { provider: "v8", include: ["src/lib/**/*.ts"], reporter: ["text", "lcov"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});

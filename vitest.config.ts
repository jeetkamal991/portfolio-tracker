import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Next keeps JSX untouched (tsconfig jsx: preserve); tests render components with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.ts"] },
});

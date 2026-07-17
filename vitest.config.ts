import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirror tsconfig "@/*" -> "./*" so lib imports resolve under Vitest.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    environment: "node",
  },
});

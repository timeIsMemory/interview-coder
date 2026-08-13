import { defineConfig } from "vitest/config"

// Standalone test config so vitest does NOT load vite.config.ts (which wires in
// the electron build plugin). Tests only cover dependency-free pure logic in
// electron/core and electron/modules, which import only Node built-ins.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false
  }
})

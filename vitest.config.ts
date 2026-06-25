import { defineConfig, configDefaults } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/lib/__tests__/setup.ts"],
    // Never scan transient git worktrees (e.g. .claude/worktrees/*), which
    // hold checkouts of other branches and would run stale duplicate tests.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

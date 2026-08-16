import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this project from https://<user>.github.io/LitogenLitePlus/
// so production assets need that prefix. Dev server stays at the root.
const REPO_BASE = "/LitogenLitePlus/";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

/**
 * Short commit the build came from, shown in the UI. Without it there is no
 * way to tell which build a bug report is actually about — a stale tab and a
 * fresh one look identical.
 */
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD").toString().trim();
  } catch {
    return "local";
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? REPO_BASE : "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
}));

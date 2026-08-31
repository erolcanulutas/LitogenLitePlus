import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Where the built assets will be asked for from.
//
// At its own domain that is the root, which is the default. GitHub Pages serves
// the project out of a folder named after the repository, so its workflow sets
// BASE_PATH to that instead.
//
// Keyed on the mode rather than the command, because `vite preview` serves the
// built files under command "serve": keying on the command handed it base "/"
// while the HTML it was serving asked for a prefix, so every asset 404'd and
// `npm run preview` never rendered anything.
const BASE_PATH = process.env.BASE_PATH || "/";

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

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? BASE_PATH : "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
}));

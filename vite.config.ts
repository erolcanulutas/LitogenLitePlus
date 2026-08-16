import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this project from https://<user>.github.io/LitogenLitePlus/
// so production assets need that prefix. Dev server stays at the root.
const REPO_BASE = "/LitogenLitePlus/";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? REPO_BASE : "/",
}));

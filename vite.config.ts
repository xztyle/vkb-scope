import { execSync } from "node:child_process";
import { defineConfig } from "vite";

const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

// base: repo name, so the built site works from GitHub Pages
// (https://<user>.github.io/vkb-scope/). Override with VKB_SCOPE_BASE for
// other hosts or local file serving.
export default defineConfig({
  base: process.env.VKB_SCOPE_BASE ?? "/vkb-scope/",
  define: { __BUILD__: JSON.stringify(commit) },
  build: { target: "es2022", outDir: "dist" },
});

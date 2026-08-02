import { defineConfig } from "vite";

// base: repo name, so the built site works from GitHub Pages
// (https://<user>.github.io/vkb-scope/). Override with VKB_SCOPE_BASE for
// other hosts or local file serving.
export default defineConfig({
  base: process.env.VKB_SCOPE_BASE ?? "/vkb-scope/",
  build: { target: "es2022", outDir: "dist" },
});

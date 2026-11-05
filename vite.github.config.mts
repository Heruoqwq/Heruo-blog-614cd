import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { themeBootstrap } from "./app/theme";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./github", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react(), { name: "heruo-theme-bootstrap", transformIndexHtml: () => [{ tag: "script", children: themeBootstrap, injectTo: "head-prepend" }] }],
  build: { outDir: fileURLToPath(new URL("./docs", import.meta.url)), emptyOutDir: true },
});

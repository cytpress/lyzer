import { defineConfig } from "astro/config";
import { fileURLToPath, URL } from "node:url";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://lyzer.tw",
  output: "static",
  integrations: [
    sitemap({
      filter: (page) => !page.startsWith("https://lyzer.tw/legislators"),
    }),
  ],
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    plugins: [tailwindcss()],
  },
});

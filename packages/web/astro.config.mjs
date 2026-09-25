import { defineConfig } from "astro/config";
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
    plugins: [tailwindcss()],
  },
});

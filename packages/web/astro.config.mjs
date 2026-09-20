import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://lyzer.tw",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});

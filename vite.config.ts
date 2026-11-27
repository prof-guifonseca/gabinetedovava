import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

const isVitest = Boolean(process.env.VITEST);

export default defineConfig({
  plugins: isVitest ? [react()] : [react(), cloudflare()],
  server: {
    port: 5173,
  },
});

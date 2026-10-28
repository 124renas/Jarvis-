import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.JARVIS_API ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/feeds": { target: api, changeOrigin: false },
    },
  },
  build: { target: "safari16", sourcemap: false },
});

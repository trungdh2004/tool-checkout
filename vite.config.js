import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/tool-api": "http://127.0.0.1:4300",
    },
  },
});

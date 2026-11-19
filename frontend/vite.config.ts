import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // reenvía al backend las peticiones que empiezan por /api quitando el prefijo
      "/api": {
        target: "http://localhost:3000",
        rewrite: (ruta) => ruta.replace(/^\/api/, ""),
      },
    },
  },
});

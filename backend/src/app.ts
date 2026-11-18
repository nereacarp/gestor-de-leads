import Fastify from "fastify";

// define cómo se construye el servidor de Fastify
export function buildApp() {
  const app = Fastify({ logger: true });

  // ruta de prueba para verificar que el servidor está funcionando
  app.get("/health", async () => ({ ok: true }));

  return app;
}

import Fastify from "fastify";
import { buscarAgentePorToken, registrarAuth, type BuscarAgente } from "./auth";

// define cómo se construye el servidor de Fastify
export function buildApp(buscarAgente: BuscarAgente = buscarAgentePorToken) {
  const app = Fastify({ logger: true });

  // registra el hook de autenticación (busca el agente que hace cada petición)
  registrarAuth(app, buscarAgente); 

  // ruta de prueba para verificar que el servidor está funcionando
  app.get("/health", async () => ({ ok: true }));

  // devuelve quién es el agente que hace la petición
  app.get("/me", async (request) => request.agente);

  return app;
}

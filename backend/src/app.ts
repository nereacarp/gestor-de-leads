import Fastify from "fastify";
import { buscarAgentePorToken, registrarAuth, type BuscarAgente } from "./auth";
import { registrarRutasAgentes } from "./agentes/rutas";
import { registrarRutasLeads } from "./leads/rutas";
import { registrarRutasPesos } from "./pesos/rutas";

// define cómo se construye el servidor de Fastify
export function buildApp(buscarAgente: BuscarAgente = buscarAgentePorToken) {
  const app = Fastify({ logger: true });

  // registra el hook de autenticación (busca el agente que hace cada petición)
  registrarAuth(app, buscarAgente); 

  // ruta de prueba para verificar que el servidor está funcionando
  app.get("/health", async () => ({ ok: true }));

  // devuelve quién es el agente que hace la petición
  app.get("/me", async (request) => request.agente);

  // registra la ruta GET /agentes que devuelve la lista de agentes
  registrarRutasAgentes(app);

  // registra la ruta GET /leads que devuelve la lista de leads con filtros, búsqueda y paginación
  registrarRutasLeads(app);

  // registra las rutas GET y PUT /pesos para ver y cambiar los pesos (solo admin)
  registrarRutasPesos(app);

  return app;
}

import Fastify, { type FastifyError } from "fastify";
import { z } from "zod";
import { buscarAgentePorToken, registrarAuth, type BuscarAgente } from "./auth";
import { registrarRutasAgentes } from "./agentes/rutas";
import { registrarRutasLeads } from "./leads/rutas";
import { registrarRutasPesos } from "./pesos/rutas";

// muestra en español los mensajes de validación de zod
z.config(z.locales.es());

// define cómo se construye el servidor de Fastify (sin registros en los tests)
export function buildApp(buscarAgente: BuscarAgente = buscarAgentePorToken) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // responde en español y con el formato { error } a los errores que no controlan las rutas
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const estado = error.statusCode ?? 500;
    if (estado >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: "error interno del servidor" });
    }
    const mensajes: Record<string, string> = {
      FST_ERR_CTP_INVALID_JSON_BODY: "el cuerpo no es un JSON válido",
      FST_ERR_CTP_EMPTY_JSON_BODY: "el cuerpo de la petición está vacío",
      FST_ERR_CTP_INVALID_MEDIA_TYPE: "el tipo de contenido no es válido",
    };
    return reply.code(estado).send({ error: mensajes[error.code] ?? "petición no válida" });
  });

  // responde en español cuando la ruta no existe
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: "ruta no encontrada" }));

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

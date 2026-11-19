import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// define cómo es un agente
export type Agente = { id: number; nombre: string; rol: "agente" | "admin" };

// describe una función que busca un agente por su token
export type BuscarAgente = (token: string) => Promise<Agente | null>;

// añade el campo agente a la petición de Fastify
declare module "fastify" {
  interface FastifyRequest {
    agente: Agente | null;
  }
}

// rutas que se pueden usar sin token
const RUTAS_PUBLICAS = ["/health"];

// busca en la base de datos el agente que tiene el token recibido
export const buscarAgentePorToken: BuscarAgente = async (token) => {
  const { sql } = await import("./db/sql.js"); 
  const filas = await sql<Agente[]>`
    select id, nombre, rol from agentes where token = ${token}
  `;
  return filas[0] ?? null;
};

// registra un hook que busca el agente que hace cada petición
export function registrarAuth(app: FastifyInstance, buscarAgente: BuscarAgente) {
  app.decorateRequest("agente", null);

  app.addHook("onRequest", async (request, reply) => { // se ejecuta al principio de cada petición
    if (RUTAS_PUBLICAS.includes(request.url)) return;
    
    const [tipo, token] = (request.headers.authorization ?? "").split(" ");
    if (tipo !== "Bearer" || !token) {
      return reply.code(401).send({ error: "falta el token de autenticación" });
    }

    const agente = await buscarAgente(token);
    if (!agente) {
      return reply.code(401).send({ error: "token no válido" });
    }

    request.agente = agente;
  });
}

// rechaza la petición si el agente no es administrador
export async function soloAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.agente?.rol !== "admin") {
    return reply.code(403).send({ error: "solo para administradores" });
  }
}

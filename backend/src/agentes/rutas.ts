import type { FastifyInstance } from "fastify";
import { listarAgentes } from "./consultas";
import { filtrosSchema } from "./esquemas";

// registra la ruta GET /agentes que devuelve la lista de agentes
export function registrarRutasAgentes(app: FastifyInstance) {
  // lista los agentes (id, nombre y rol) con filtro opcional por rol
  app.get("/agentes", async (request, reply) => {
    const resultado = filtrosSchema.safeParse(request.query);
    if (!resultado.success) {
      return reply.code(400).send({
        error: "parámetros no válidos",
        detalles: resultado.error.issues.map((problema) => ({
          campo: problema.path.join("."),
          mensaje: problema.message,
        })),
      });
    }

    return { datos: await listarAgentes(resultado.data) };
  });
}

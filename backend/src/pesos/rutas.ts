import type { FastifyInstance } from "fastify";
import { soloAdmin } from "../auth";
import { guardarPesos, leerPesos } from "./consultas";
import { pesosSchema } from "./esquemas";

// registra las rutas GET y PUT /pesos que permiten ver y cambiar los pesos (solo admin)
export function registrarRutasPesos(app: FastifyInstance) {
  // devuelve los pesos actuales
  app.get("/pesos", { preHandler: soloAdmin }, async () => ({ datos: await leerPesos() }));

  // cambia los pesos si son válidos y devuelve los pesos guardados
  app.put("/pesos", { preHandler: soloAdmin }, async (request, reply) => {
    const resultado = pesosSchema.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({
        error: "pesos no válidos",
        detalles: resultado.error.issues.map((problema) => ({
          campo: problema.path.join("."),
          mensaje: problema.message,
        })),
      });
    }

    return { datos: await guardarPesos(resultado.data) };
  });
}

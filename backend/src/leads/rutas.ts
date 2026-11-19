import type { FastifyInstance } from "fastify";
import { contarLeads, listarLeads, type FilaLead } from "./consultas";
import { filtrosSchema } from "./esquemas";

// redondea a un decimal
function redondear(numero: number) {
  return Math.round(numero * 10) / 10;
}

// convierte una fila de la base de datos en el lead que se devuelve
function aLead(fila: FilaLead) {
  const criterios = [
    { criterio: "Cliente nuevo", valoracion: fila.val_cliente_nuevo, peso: fila.peso_cliente_nuevo },
    { criterio: "Interés comercial", valoracion: fila.val_interes, peso: fila.peso_interes },
    { criterio: "Origen del lead", valoracion: fila.val_origen, peso: fila.peso_origen },
    { criterio: "Antigüedad", valoracion: fila.val_antiguedad, peso: fila.peso_antiguedad },
  ];

  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono,
    estado: fila.estado,
    agente: fila.agente_id ? { id: fila.agente_id, nombre: fila.agente_nombre } : null,
    version: fila.version,
    creado: fila.created_at,
    actualizado: fila.updated_at,
    puntuacion: redondear(fila.puntuacion),
    prioridad: fila.prioridad,
    desglose: criterios.map((c) => ({
      criterio: c.criterio,
      valoracion: redondear(c.valoracion),
      peso: c.peso,
      aporte: redondear((c.valoracion * c.peso) / 100),
    })),
  };
}

// registra la ruta GET /leads que devuelve la lista de leads con filtros, búsqueda y paginación
export function registrarRutasLeads(app: FastifyInstance) {
  // lista los leads con filtros, búsqueda y paginación, ordenados por puntuación
  app.get("/leads", async (request, reply) => {
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

    const filtros = resultado.data;
    const filas = await listarLeads(filtros);

    // numero total de leads que cumplen los filtros, para calcular el total de páginas
    const total =
      filas.length > 0 ? filas[0].total : filtros.pagina > 1 ? await contarLeads(filtros) : 0;

    return {
      datos: filas.map(aLead),
      total,
      pagina: filtros.pagina,
      limite: filtros.limite,
    };
  });
}

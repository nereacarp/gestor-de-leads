import type { FastifyInstance } from "fastify";
import type { ZodError } from "zod";
import { buscarRolAgente, contarLeads, crearLead, listarLeads, obtenerLead, type FilaLead } from "./consultas";
import { filtrosSchema, idSchema, nuevoLeadSchema } from "./esquemas";

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

// convierte los errores de validación de zod en la lista de detalles que devuelve la api
function aDetalles(error: ZodError) {
  return error.issues.map((problema) => {
    // si el error es por claves no reconocidas devuelve los campos no permitidos
    if (problema.code === "unrecognized_keys") {
      return { campo: problema.keys.join(", "), mensaje: "campo no permitido" };
    }
    return { campo: problema.path.join("."), mensaje: problema.message };
  });
}

// registra las rutas GET /leads, GET /leads/:id y POST /leads
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

  // devuelve un lead por su id con su puntuación y su desglose
  app.get("/leads/:id", async (request, reply) => {
    const resultado = idSchema.safeParse(request.params);
    if (!resultado.success) {
      return reply.code(400).send({ error: "id no válido", detalles: aDetalles(resultado.error) });
    }

    const fila = await obtenerLead(resultado.data.id);
    if (!fila) return reply.code(404).send({ error: "lead no encontrado" });

    return aLead(fila);
  });

  // crea un lead (nuevo y sin agente, o en gestión si trae agenteId) y lo devuelve
  app.post("/leads", async (request, reply) => {
    const resultado = nuevoLeadSchema.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({ error: "datos no válidos", detalles: aDetalles(resultado.error) });
    }

    const datos = resultado.data;
    if (datos.agenteId !== undefined) {
      // un agente solo puede crearse leads a sí mismo pero el admin puede asignar a cualquier agente
      if (request.agente?.rol === "agente" && request.agente.id !== datos.agenteId) {
        return reply.code(403).send({ error: "un agente solo puede crear leads asignados a sí mismo" });
      }

      // el agente tiene que existir y no ser administrador
      const rol = await buscarRolAgente(datos.agenteId);
      if (rol !== "agente") {
        const mensaje = rol === null ? "el agente no existe" : "no se pueden asignar leads a un administrador";
        return reply.code(400).send({ error: "datos no válidos", detalles: [{ campo: "agenteId", mensaje }] });
      }
    }

    const fila = await crearLead(datos);
    return reply.code(201).send(aLead(fila));
  });
}

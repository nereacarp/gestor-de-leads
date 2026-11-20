import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import {
  asignarLead,
  buscarRolAgente,
  cambiarEstado,
  contarLeads,
  crearLead,
  editarLead,
  liberarLead,
  listarLeads,
  obtenerLead,
  type FilaLead,
} from "./consultas";
import { asignarSchema, editarLeadSchema, ESTADOS, estadoSchema, filtrosSchema, idSchema, liberarSchema, nuevoLeadSchema } from "./esquemas";

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

// mensaje del error cuando la versión que manda el cliente ya no es la actual
const MENSAJE_CONFLICTO = "el lead ha sido modificado por otra persona";

// responde 409 con el lead tal como está ahora para que el cliente lo vea
async function enviarConflicto(reply: FastifyReply, id: number) {
  const actual = await obtenerLead(id);
  return reply.code(409).send({ error: MENSAJE_CONFLICTO, actual: actual ? aLead(actual) : null });
}

// estados a los que se puede pasar desde cada estado con PUT /leads/:id/estado
// (a nuevo se vuelve liberando el lead y un lead nuevo pasa a en gestión asignándolo)
const TRANSICIONES: Record<(typeof ESTADOS)[number], string[]> = {
  nuevo: ["cerrado"],
  en_gestion: ["contactado", "cerrado"],
  contactado: ["en_gestion", "cerrado"],
  cerrado: ["en_gestion", "contactado"],
};

// devuelve el motivo por el que no se puede pasar de un estado a otro, o null si se puede
function motivoDeRechazo(de: string, a: string, tieneAgente: boolean) {
  if (de === a) return `el lead ya está en estado ${a}`;
  if (a === "nuevo") return "para dejar un lead como nuevo hay que liberarlo";
  if (!TRANSICIONES[de as keyof typeof TRANSICIONES].includes(a)) {
    return de === "nuevo"
      ? "un lead nuevo solo puede asignarse a un agente o cerrarse"
      : `no se puede pasar de ${de} a ${a}`;
  }
  // un lead sin agente solo puede cerrarse: para reabrirlo hay que asignarlo
  if (!tieneAgente && a !== "cerrado") return "un lead cerrado sin agente se reabre asignándolo a un agente";
  return null;
}

// registra las rutas GET /leads, GET /leads/:id, POST /leads, PUT /leads/:id, POST /leads/:id/asignar y /liberar y PUT /leads/:id/estado
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

  // cambia los datos de un lead si la versión que manda el cliente sigue siendo la actual
  app.put("/leads/:id", async (request, reply) => {
    const parametros = idSchema.safeParse(request.params);
    if (!parametros.success) {
      return reply.code(400).send({ error: "id no válido", detalles: aDetalles(parametros.error) });
    }
    const resultado = editarLeadSchema.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({ error: "datos no válidos", detalles: aDetalles(resultado.error) });
    }

    const id = parametros.data.id;
    const existente = await obtenerLead(id);
    if (!existente) return reply.code(404).send({ error: "lead no encontrado" });

    // puede editar el admin, el agente asignado o cualquier agente si el lead no tiene agente
    const yo = request.agente;
    const puedeEditar = yo?.rol === "admin" || existente.agente_id === null || existente.agente_id === yo?.id;
    if (!puedeEditar) {
      return reply.code(403).send({ error: "solo el agente asignado o un administrador pueden editar este lead" });
    }

    const editado = await editarLead(id, resultado.data);
    if (!editado) return enviarConflicto(reply, id);

    return aLead(editado);
  });

  // asigna un lead a un agente: el admin a cualquiera y un agente solo a sí mismo y si el lead está libre
  app.post("/leads/:id/asignar", async (request, reply) => {
    const parametros = idSchema.safeParse(request.params);
    if (!parametros.success) {
      return reply.code(400).send({ error: "id no válido", detalles: aDetalles(parametros.error) });
    }
    const resultado = asignarSchema.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({ error: "datos no válidos", detalles: aDetalles(resultado.error) });
    }

    const id = parametros.data.id;
    const { agenteId, version } = resultado.data;
    if (!(await obtenerLead(id))) return reply.code(404).send({ error: "lead no encontrado" });

    // el agente tiene que existir y no ser administrador
    const rol = await buscarRolAgente(agenteId);
    if (rol !== "agente") {
      const mensaje = rol === null ? "el agente no existe" : "no se pueden asignar leads a un administrador";
      return reply.code(400).send({ error: "datos no válidos", detalles: [{ campo: "agenteId", mensaje }] });
    }

    // un agente solo puede asignarse leads a sí mismo
    const esAdmin = request.agente?.rol === "admin";
    if (!esAdmin && request.agente?.id !== agenteId) {
      return reply.code(403).send({ error: "un agente solo puede asignarse leads a sí mismo" });
    }

    // un agente solo puede coger leads libres; el admin también puede cambiar el agente de uno asignado
    const asignado = await asignarLead(id, agenteId, version, !esAdmin);
    if (!asignado) {
      const actual = await obtenerLead(id);
      const error =
        !esAdmin && actual?.agente_id ? `el lead ya está asignado a ${actual.agente_nombre}` : MENSAJE_CONFLICTO;
      return reply.code(409).send({ error, actual: actual ? aLead(actual) : null });
    }

    return aLead(asignado);
  });

  // quita el agente de un lead: el admin de cualquiera y un agente solo de los suyos
  app.post("/leads/:id/liberar", async (request, reply) => {
    const parametros = idSchema.safeParse(request.params);
    if (!parametros.success) {
      return reply.code(400).send({ error: "id no válido", detalles: aDetalles(parametros.error) });
    }
    const resultado = liberarSchema.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({ error: "datos no válidos", detalles: aDetalles(resultado.error) });
    }

    const id = parametros.data.id;
    const existente = await obtenerLead(id);
    if (!existente) return reply.code(404).send({ error: "lead no encontrado" });

    // si ya no tiene agente, la pantalla estaba desactualizada
    if (existente.agente_id === null) {
      return reply.code(409).send({ error: "el lead no tiene agente asignado", actual: aLead(existente) });
    }

    const yo = request.agente;
    if (yo?.rol !== "admin" && existente.agente_id !== yo?.id) {
      return reply.code(403).send({ error: "solo el agente asignado o un administrador pueden liberar este lead" });
    }

    const liberado = await liberarLead(id, resultado.data.version);
    if (!liberado) return enviarConflicto(reply, id);

    return aLead(liberado);
  });

  // cambia el estado de un lead entre los pasos permitidos (comprobando permisos y versión)
  app.put("/leads/:id/estado", async (request, reply) => {
    const parametros = idSchema.safeParse(request.params);
    if (!parametros.success) {
      return reply.code(400).send({ error: "id no válido", detalles: aDetalles(parametros.error) });
    }
    const resultado = estadoSchema.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({ error: "datos no válidos", detalles: aDetalles(resultado.error) });
    }

    const id = parametros.data.id;
    const { estado, version } = resultado.data;
    const existente = await obtenerLead(id);
    if (!existente) return reply.code(404).send({ error: "lead no encontrado" });

    // puede cambiar el estado el admin, el agente asignado o cualquier agente si el lead no tiene agente
    const yo = request.agente;
    const puedeCambiar = yo?.rol === "admin" || existente.agente_id === null || existente.agente_id === yo?.id;
    if (!puedeCambiar) {
      return reply.code(403).send({ error: "solo el agente asignado o un administrador pueden cambiar este lead" });
    }

    // si la versión está desactualizada se avisa antes de mirar el cambio de estado
    if (existente.version !== version) return enviarConflicto(reply, id);

    const motivo = motivoDeRechazo(existente.estado, estado, existente.agente_id !== null);
    if (motivo) {
      return reply.code(400).send({
        error: "cambio de estado no permitido",
        detalles: [{ campo: "estado", mensaje: motivo }],
      });
    }

    const cambiado = await cambiarEstado(id, estado, version);
    if (!cambiado) return enviarConflicto(reply, id);

    return aLead(cambiado);
  });
}

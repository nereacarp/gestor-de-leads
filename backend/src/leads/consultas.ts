import { sql } from "../db/sql";
import type { Filtros, NuevoLead } from "./esquemas";

// describe cómo es cada fila que devuelve la consulta de leads
export type FilaLead = {
  id: number;
  nombre: string;
  telefono: string;
  estado: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  agente_id: number | null;
  agente_nombre: string | null;
  puntuacion: number;
  prioridad: "alta" | "media" | "baja";
  val_cliente_nuevo: number;
  val_interes: number;
  val_origen: number;
  val_antiguedad: number;
  peso_cliente_nuevo: number;
  peso_interes: number;
  peso_origen: number;
  peso_antiguedad: number;
};

// columnas de un lead con su agente, su puntuación, sus valoraciones y los pesos aplicados
const columnasLead = sql`
  lp.id, lp.nombre, lp.telefono, lp.estado, lp.version, lp.created_at, lp.updated_at,
  lp.agente_id, a.nombre as agente_nombre,
  lp.puntuacion, lp.prioridad,
  lp.val_cliente_nuevo, lp.val_interes, lp.val_origen, lp.val_antiguedad,
  lp.peso_cliente_nuevo, lp.peso_interes, lp.peso_origen, lp.peso_antiguedad
`;

// limpia los caracteres especiales
function escapar(texto: string) {
  return texto.replace(/[\\%_]/g, "\\$&");
}

// construye el where con solo los filtros que se han pedido
function condiciones({ estado, agente, q }: Filtros) {
  const porEstado = estado ? sql`and lp.estado = ${estado}` : sql``;

  const porAgente =
    agente === undefined
      ? sql``
      : agente === "sin"
        ? sql`and lp.agente_id is null`
        : sql`and lp.agente_id = ${agente}`;

  const patron = q ? `%${escapar(q)}%` : null;
  const porTexto = patron
    ? sql`and (lp.nombre ilike ${patron} or lp.telefono ilike ${patron})`
    : sql``;

  return sql`where true ${porEstado} ${porAgente} ${porTexto}`;
}

// devuelve una página de leads ordenados por puntuación, con el total que cumple los filtros
export async function listarLeads(filtros: Filtros) {
  const desplazamiento = (filtros.pagina - 1) * filtros.limite;

  return sql<(FilaLead & { total: number })[]>`
    select
      ${columnasLead},
      count(*) over()::int as total
    from leads_puntuados lp
    left join agentes a on a.id = lp.agente_id
    ${condiciones(filtros)}
    order by lp.puntuacion desc, lp.id asc
    limit ${filtros.limite} offset ${desplazamiento}
  `;
}

// cuenta los leads que cumplen los filtros (para cuando la página pedida está vacía)
export async function contarLeads(filtros: Filtros) {
  const filas = await sql<{ total: number }[]>`
    select count(*)::int as total
    from leads_puntuados lp
    ${condiciones(filtros)}
  `;
  return filas[0].total;
}

// devuelve un lead por su id
export async function obtenerLead(id: number) {
  const filas = await sql<FilaLead[]>`
    select ${columnasLead}
    from leads_puntuados lp
    left join agentes a on a.id = lp.agente_id
    where lp.id = ${id}
  `;
  return filas[0] ?? null;
}

// devuelve el rol de un agente
export async function buscarRolAgente(id: number) {
  const filas = await sql<{ rol: "agente" | "admin" }[]>`select rol from agentes where id = ${id}`;
  return filas[0]?.rol ?? null;
}

// crea un lead (nuevo y sin agente o en gestión si trae agente) y lo devuelve con su puntuación
export async function crearLead(datos: NuevoLead) {
  const agenteId = datos.agenteId ?? null;
  // un lead con agente nace en gestión, igual que al asignarlo
  const estado = agenteId === null ? "nuevo" : "en_gestion";

  const [{ id }] = await sql<{ id: number }[]>`
    insert into leads (nombre, telefono, estado, agente_id, cliente_nuevo, interes, origen)
    values (${datos.nombre}, ${datos.telefono}, ${estado}, ${agenteId}, ${datos.clienteNuevo},
            ${datos.interes ?? null}, ${datos.origen ?? null})
    returning id
  `;

  const lead = await obtenerLead(id);
  if (!lead) throw new Error("no se encuentra el lead recién creado");
  return lead;
}

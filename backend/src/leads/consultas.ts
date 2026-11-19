import { sql } from "../db/sql";
import type { Filtros } from "./esquemas";

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
  total: number;
};

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

  return sql<FilaLead[]>`
    select
      lp.id, lp.nombre, lp.telefono, lp.estado, lp.version, lp.created_at, lp.updated_at,
      lp.agente_id, a.nombre as agente_nombre,
      lp.puntuacion, lp.prioridad,
      lp.val_cliente_nuevo, lp.val_interes, lp.val_origen, lp.val_antiguedad,
      lp.peso_cliente_nuevo, lp.peso_interes, lp.peso_origen, lp.peso_antiguedad,
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

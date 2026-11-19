import { sql } from "../db/sql";
import type { Filtros } from "./esquemas";

// describe cada fila con los datos de un agente (nunca incluye el token)
export type FilaAgente = { id: number; nombre: string; rol: "agente" | "admin" };

// devuelve los agentes ordenados por id (con filtro opcional de rol)
export async function listarAgentes({ rol }: Filtros) {
  return sql<FilaAgente[]>`
    select id, nombre, rol
    from agentes
    ${rol ? sql`where rol = ${rol}` : sql``}
    order by id asc
  `;
}

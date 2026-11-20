import { sql } from "../db/sql";
import type { Criterio, Pesos } from "./esquemas";

// describe cómo es la fila de la tabla pesos
type FilaPesos = {
  peso_cliente_nuevo: number;
  peso_interes: number;
  peso_origen: number;
  peso_antiguedad: number;
};

// convierte la fila de pesos en la lista de criterios con su peso
function aLista(fila: FilaPesos): Pesos {
  return [
    { criterio: "cliente_nuevo", peso: fila.peso_cliente_nuevo },
    { criterio: "interes", peso: fila.peso_interes },
    { criterio: "origen", peso: fila.peso_origen },
    { criterio: "antiguedad", peso: fila.peso_antiguedad },
  ];
}

// devuelve los pesos actuales como una lista de criterios
export async function leerPesos() {
  const [fila] = await sql<FilaPesos[]>`
    select peso_cliente_nuevo, peso_interes, peso_origen, peso_antiguedad
    from pesos
  `;
  return aLista(fila);
}

// guarda los 4 pesos a la vez con un solo update y devuelve los pesos guardados
export async function guardarPesos(lista: Pesos) {
  // pasa la lista a un objeto para buscar cada peso por su criterio
  const p = Object.fromEntries(lista.map((c) => [c.criterio, c.peso])) as Record<Criterio, number>;

  const [fila] = await sql<FilaPesos[]>`
    update pesos
    set peso_cliente_nuevo = ${p.cliente_nuevo}, peso_interes = ${p.interes},
        peso_origen = ${p.origen}, peso_antiguedad = ${p.antiguedad}
    returning peso_cliente_nuevo, peso_interes, peso_origen, peso_antiguedad
  `;
  return aLista(fila);
}

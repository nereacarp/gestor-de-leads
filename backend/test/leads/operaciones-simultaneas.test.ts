import { describe, expect, it } from "vitest";
import { crearAgente, editarPorApi, crearLeadConId, leerFila, edicion, asignarPorApi, liberarPorApi, estadoPorApi, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

// tests de operaciones distintas sobre el mismo lead a la vez
describe("operaciones distintas a la vez sobre el mismo lead", () => {
  it("con la misma versión, editar, asignar, cambiar el estado y liberar a la vez: solo una se guarda", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Original", estado: "en_gestion", agenteId: ana });

    const operaciones = {
      editar: () => editarPorApi(id, edicion(1, { nombre: "Editado" })),
      asignar: () => asignarPorApi(id, { agenteId: luis, version: 1 }),
      estado: () => estadoPorApi(id, { estado: "contactado", version: 1 }),
      liberar: () => liberarPorApi(id, { version: 1 }),
    };
    const nombresOperaciones = Object.keys(operaciones) as (keyof typeof operaciones)[];

    // cada operación se lanza dos veces para que haya más choques
    const lanzadas = [...nombresOperaciones, ...nombresOperaciones];
    const respuestas = await Promise.all(lanzadas.map((nombre) => operaciones[nombre]()));

    const ganadoras = respuestas.map((r, i) => ({ operacion: lanzadas[i], ...r })).filter((r) => r.codigo === 200);
    expect(ganadoras).toHaveLength(1);
    expect(respuestas.filter((r) => r.codigo === 409)).toHaveLength(7);

    // el lead refleja solo lo que hizo la operación ganadora y sube una sola versión
    const fila = await leerFila(id);
    expect(fila.version).toBe(2);
    const esperado = {
      editar: { nombre: "Editado", agente_id: ana, estado: "en_gestion" },
      asignar: { nombre: "Original", agente_id: luis, estado: "en_gestion" },
      estado: { nombre: "Original", agente_id: ana, estado: "contactado" },
      liberar: { nombre: "Original", agente_id: null, estado: "nuevo" },
    };
    expect(fila).toMatchObject(esperado[ganadoras[0].operacion]);
  });
});

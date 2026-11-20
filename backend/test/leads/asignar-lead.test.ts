import { describe, expect, it } from "vitest";
import { sql } from "../../src/db/sql";
import { type Lead, crearAgente, editarPorApi, crearLeadConId, leerFila, edicion, servidorComo, asignarPorApi, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

// tests de POST /leads/:id/asignar
describe("asignar un lead", () => {
  it("el admin asigna un lead libre: pasa a en gestión y sube la versión", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead" });

    const { codigo, cuerpo } = await asignarPorApi(id, { agenteId: ana, version: 1 });

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana, nombre: "Ana" }, version: 2 });
  });

  it("asignar un lead cerrado sin agente lo reabre en gestión", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "cerrado" });

    const { cuerpo } = await asignarPorApi(id, { agenteId: ana, version: 1 });

    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana } });
  });

  it("el admin cambia el agente de un lead asignado y se mantiene el estado", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead", estado: "contactado", agenteId: ana });

    const { codigo, cuerpo } = await asignarPorApi(id, { agenteId: luis, version: 1 });

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: "contactado", agente: { id: luis }, version: 2 });
  });

  it("al cambiar el agente de un lead cerrado, sigue cerrado", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead", estado: "cerrado", agenteId: ana });

    const { cuerpo } = await asignarPorApi(id, { agenteId: luis, version: 1 });

    expect(cuerpo).toMatchObject({ estado: "cerrado", agente: { id: luis } });
  });

  it("un agente puede asignarse un lead libre", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead" });
    const comoAna = servidorComo(ana, "agente");

    const { codigo, cuerpo } = await asignarPorApi(id, { agenteId: ana, version: 1 }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana } });
  });

  it("un agente no puede asignar el lead a otro agente", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead" });
    const comoAna = servidorComo(ana, "agente");

    const { codigo } = await asignarPorApi(id, { agenteId: luis, version: 1 }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(403);
    expect(await leerFila(id)).toMatchObject({ agente_id: null, version: 1 });
  });

  it("un agente no puede quitarle un lead asignado a otro: 409 con el lead actual", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    const comoLuis = servidorComo(luis, "agente");

    const { codigo, cuerpo } = await asignarPorApi(id, { agenteId: luis, version: 1 }, comoLuis);
    await comoLuis.close();

    expect(codigo).toBe(409);
    expect(cuerpo.error).toBe("el lead ya está asignado a Ana");
    expect(cuerpo.actual).toMatchObject({ agente: { id: ana } });
    expect(await leerFila(id)).toMatchObject({ agente_id: ana, version: 1 });
  });

  it("si dos agentes lo piden a la vez, solo uno se queda el lead", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead" });
    const comoAna = servidorComo(ana, "agente");
    const comoLuis = servidorComo(luis, "agente");

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? asignarPorApi(id, { agenteId: ana, version: 1 }, comoAna)
          : asignarPorApi(id, { agenteId: luis, version: 1 }, comoLuis),
      ),
    );
    await comoAna.close();
    await comoLuis.close();

    const ganadoras = respuestas.filter((r) => r.codigo === 200);
    expect(ganadoras).toHaveLength(1);
    expect(respuestas.filter((r) => r.codigo === 409)).toHaveLength(9);
    expect(await leerFila(id)).toMatchObject({ agente_id: ganadoras[0].cuerpo.agente.id, estado: "en_gestion", version: 2 });
  });

  it("si el admin cambia el agente a la vez a dos agentes distintos, solo uno se guarda", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const marta = await crearAgente("Marta");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });

    const respuestas = await Promise.all([
      asignarPorApi(id, { agenteId: luis, version: 1 }),
      asignarPorApi(id, { agenteId: marta, version: 1 }),
      asignarPorApi(id, { agenteId: luis, version: 1 }),
      asignarPorApi(id, { agenteId: marta, version: 1 }),
    ]);

    const ganadoras = respuestas.filter((r) => r.codigo === 200);
    expect(ganadoras).toHaveLength(1);
    expect(respuestas.filter((r) => r.codigo === 409)).toHaveLength(3);
    expect(await leerFila(id)).toMatchObject({ agente_id: ganadoras[0].cuerpo.agente.id, version: 2 });
  });

  it("devuelve 409 con el lead actual si la versión ya no coincide", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead" });
    await editarPorApi(id, edicion(1, { nombre: "Cambiado" }));

    const { codigo, cuerpo } = await asignarPorApi(id, { agenteId: ana, version: 1 });

    expect(codigo).toBe(409);
    expect(cuerpo.error).toBe("el lead ha sido modificado por otra persona");
    expect(cuerpo.actual).toMatchObject({ nombre: "Cambiado", version: 2, agente: null });
    expect(await leerFila(id)).toMatchObject({ agente_id: null });
  });

  it("una edición con la versión anterior a la asignación da 409", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead" });
    await asignarPorApi(id, { agenteId: ana, version: 1 });

    const { codigo } = await editarPorApi(id, edicion(1));

    expect(codigo).toBe(409);
  });

  it("rechaza asignar a un agente que no existe o a un administrador", async () => {
    const id = await crearLeadConId({ nombre: "Lead" });
    const [{ id: admin }] = await sql<{ id: number }[]>`
      insert into agentes (nombre, rol, token) values ('Jefa', 'admin', 'token-jefa') returning id
    `;

    const inexistente = await asignarPorApi(id, { agenteId: 999, version: 1 });
    const alAdmin = await asignarPorApi(id, { agenteId: admin, version: 1 });

    expect(inexistente.codigo).toBe(400);
    expect(inexistente.cuerpo.detalles).toEqual([{ campo: "agenteId", mensaje: "el agente no existe" }]);
    expect(alAdmin.codigo).toBe(400);
    expect(alAdmin.cuerpo.detalles[0].mensaje).toBe("no se pueden asignar leads a un administrador");
    expect(await leerFila(id)).toMatchObject({ agente_id: null, version: 1 });
  });

  it.each<[string, unknown]>([
    ["sin agenteId", { version: 1 }],
    ["sin versión", { agenteId: 1 }],
    ["con la versión 0", { agenteId: 1, version: 0 }],
    ["con agenteId como texto", { agenteId: "1", version: 1 }],
    ["con el campo estado", { agenteId: 1, version: 1, estado: "cerrado" }],
  ])("rechaza asignar %s", async (_descripcion, cuerpo) => {
    await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead" });

    const res = await asignarPorApi(id, cuerpo);

    expect(res.codigo).toBe(400);
    expect(await leerFila(id)).toMatchObject({ agente_id: null, version: 1 });
  });

  it("devuelve 404 si el lead no existe y 400 si el id no es válido", async () => {
    const ana = await crearAgente("Ana");

    const noExiste = await asignarPorApi(999, { agenteId: ana, version: 1 });
    const idMalo = await asignarPorApi("abc", { agenteId: ana, version: 1 });

    expect(noExiste.codigo).toBe(404);
    expect(idMalo.codigo).toBe(400);
  });
});

import { describe, expect, it } from "vitest";
import { type Lead, crearAgente, crearLeadConId, leerFila, servidorComo, asignarPorApi, liberarPorApi, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

// tests de POST /leads/:id/liberar
describe("liberar un lead", () => {
  it.each([
    ["en gestión", "en_gestion", "nuevo"],
    ["contactado", "contactado", "nuevo"],
    ["cerrado", "cerrado", "cerrado"],
  ])("un agente libera su lead %s y queda %s sin agente", async (_descripcion, antes, despues) => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: antes, agenteId: ana });
    const comoAna = servidorComo(ana, "agente");

    const { codigo, cuerpo } = await liberarPorApi(id, { version: 1 }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: despues, agente: null, version: 2 });
  });

  it("el admin puede liberar el lead de cualquier agente", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });

    const { codigo, cuerpo } = await liberarPorApi(id, { version: 1 });

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: "nuevo", agente: null });
  });

  it("un agente no puede liberar el lead de otro agente", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: luis });
    const comoAna = servidorComo(ana, "agente");

    const { codigo } = await liberarPorApi(id, { version: 1 }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(403);
    expect(await leerFila(id)).toMatchObject({ agente_id: luis, version: 1 });
  });

  it("si el lead ya no tiene agente devuelve 409 con el lead actual", async () => {
    const id = await crearLeadConId({ nombre: "Lead" });

    const { codigo, cuerpo } = await liberarPorApi(id, { version: 1 });

    expect(codigo).toBe(409);
    expect(cuerpo.error).toBe("el lead no tiene agente asignado");
    expect(cuerpo.actual).toMatchObject({ id, agente: null });
  });

  it("devuelve 409 con el lead actual si la versión ya no coincide", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    await asignarPorApi(id, { agenteId: luis, version: 1 });

    const { codigo, cuerpo } = await liberarPorApi(id, { version: 1 });

    expect(codigo).toBe(409);
    expect(cuerpo.actual).toMatchObject({ agente: { id: luis }, version: 2 });
    expect(await leerFila(id)).toMatchObject({ agente_id: luis });
  });

  it("si el agente y el admin lo liberan a la vez, solo uno lo consigue", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    const comoAna = servidorComo(ana, "agente");

    const respuestas = await Promise.all([
      liberarPorApi(id, { version: 1 }, comoAna),
      liberarPorApi(id, { version: 1 }),
      liberarPorApi(id, { version: 1 }, comoAna),
      liberarPorApi(id, { version: 1 }),
    ]);
    await comoAna.close();

    expect(respuestas.filter((r) => r.codigo === 200)).toHaveLength(1);
    expect(respuestas.filter((r) => r.codigo === 409)).toHaveLength(3);
    expect(await leerFila(id)).toMatchObject({ agente_id: null, estado: "nuevo", version: 2 });
  });

  it("después de liberar, otro agente puede asignárselo con la versión nueva", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    const liberado = await liberarPorApi(id, { version: 1 });
    const comoLuis = servidorComo(luis, "agente");

    const { codigo, cuerpo } = await asignarPorApi(id, { agenteId: luis, version: liberado.cuerpo.version }, comoLuis);
    await comoLuis.close();

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ agente: { id: luis }, estado: "en_gestion", version: 3 });
  });

  it.each<[string, unknown]>([
    ["sin versión", {}],
    ["con la versión como texto", { version: "1" }],
    ["con otros campos", { version: 1, agenteId: 2 }],
  ])("rechaza liberar %s", async (_descripcion, cuerpo) => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });

    const res = await liberarPorApi(id, cuerpo);

    expect(res.codigo).toBe(400);
    expect(await leerFila(id)).toMatchObject({ agente_id: ana, version: 1 });
  });

  it("devuelve 404 si el lead no existe y 400 si el id no es válido", async () => {
    const noExiste = await liberarPorApi(999, { version: 1 });
    const idMalo = await liberarPorApi("abc", { version: 1 });

    expect(noExiste.codigo).toBe(404);
    expect(idMalo.codigo).toBe(400);
  });
});

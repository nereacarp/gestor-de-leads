import { describe, expect, it } from "vitest";
import { type Lead, crearAgente, editarPorApi, crearLeadConId, leerFila, edicion, servidorComo, estadoPorApi, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

// tests de PUT /leads/:id/estado
describe("cambiar el estado de un lead", () => {
  it.each([
    ["en_gestion", "contactado"],
    ["en_gestion", "cerrado"],
    ["contactado", "en_gestion"],
    ["contactado", "cerrado"],
    ["cerrado", "en_gestion"],
    ["cerrado", "contactado"],
  ])("permite pasar de %s a %s y mantiene el agente", async (de, a) => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: de, agenteId: ana });

    const { codigo, cuerpo } = await estadoPorApi(id, { estado: a, version: 1 });

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: a, agente: { id: ana }, version: 2 });
    expect(await leerFila(id)).toMatchObject({ estado: a, agente_id: ana, version: 2 });
  });

  it("permite cerrar un lead nuevo sin agente y se queda sin agente", async () => {
    const id = await crearLeadConId({ nombre: "Lead" });

    const { codigo, cuerpo } = await estadoPorApi(id, { estado: "cerrado", version: 1 });

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ estado: "cerrado", agente: null, version: 2 });
    expect(await leerFila(id)).toMatchObject({ estado: "cerrado", agente_id: null });
  });

  it.each<[string, string, boolean, string]>([
    ["nuevo", "en_gestion", false, "un lead nuevo solo puede asignarse a un agente o cerrarse"],
    ["nuevo", "contactado", false, "un lead nuevo solo puede asignarse a un agente o cerrarse"],
    ["en_gestion", "nuevo", true, "para dejar un lead como nuevo hay que liberarlo"],
    ["contactado", "nuevo", true, "para dejar un lead como nuevo hay que liberarlo"],
    ["en_gestion", "en_gestion", true, "el lead ya está en estado en_gestion"],
    ["cerrado", "en_gestion", false, "un lead cerrado sin agente se reabre asignándolo a un agente"],
    ["cerrado", "contactado", false, "un lead cerrado sin agente se reabre asignándolo a un agente"],
  ])("rechaza pasar de %s a %s (con agente: %s)", async (de, a, conAgente, mensaje) => {
    const agenteId = conAgente ? await crearAgente("Ana") : null;
    const id = await crearLeadConId({ nombre: "Lead", estado: de, agenteId });

    const { codigo, cuerpo } = await estadoPorApi(id, { estado: a, version: 1 });

    expect(codigo).toBe(400);
    expect(cuerpo.error).toBe("cambio de estado no permitido");
    expect(cuerpo.detalles).toEqual([{ campo: "estado", mensaje }]);
    expect(await leerFila(id)).toMatchObject({ estado: de, version: 1 });
  });

  it("devuelve 409 con el lead actual si la versión ya no coincide, y no cambia nada", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    await estadoPorApi(id, { estado: "contactado", version: 1 });

    const { codigo, cuerpo } = await estadoPorApi(id, { estado: "cerrado", version: 1 });

    expect(codigo).toBe(409);
    expect(cuerpo.actual).toMatchObject({ estado: "contactado", version: 2 });
    expect(await leerFila(id)).toMatchObject({ estado: "contactado", version: 2 });
  });

  it("si la versión está desactualizada da 409 aunque el cambio ya no sea posible", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    await estadoPorApi(id, { estado: "cerrado", version: 1 });

    const { codigo } = await estadoPorApi(id, { estado: "contactado", version: 1 });

    expect(codigo).toBe(409);
  });

  it("si varias personas cambian el estado a la vez, solo una lo consigue", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) => estadoPorApi(id, { estado: i % 2 === 0 ? "contactado" : "cerrado", version: 1 })),
    );

    const ganadoras = respuestas.filter((r) => r.codigo === 200);
    expect(ganadoras).toHaveLength(1);
    expect(respuestas.filter((r) => r.codigo === 409)).toHaveLength(9);
    expect(await leerFila(id)).toMatchObject({ estado: ganadoras[0].cuerpo.estado, version: 2 });
  });

  it("después de cambiar el estado, una edición con la versión anterior da 409", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
    await estadoPorApi(id, { estado: "contactado", version: 1 });

    const { codigo } = await editarPorApi(id, edicion(1));

    expect(codigo).toBe(409);
  });

  it.each<[string, unknown]>([
    ["sin estado", { version: 1 }],
    ["sin versión", { estado: "cerrado" }],
    ["con un estado que no existe", { estado: "perdido", version: 1 }],
    ["con la versión como texto", { estado: "cerrado", version: "1" }],
    ["con otros campos", { estado: "cerrado", version: 1, agenteId: 1 }],
  ])("rechaza cambiar el estado %s y no cambia nada", async (_descripcion, cuerpo) => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });

    const res = await estadoPorApi(id, cuerpo);

    expect(res.codigo).toBe(400);
    expect(res.cuerpo.error).toBe("datos no válidos");
    expect(await leerFila(id)).toMatchObject({ estado: "en_gestion", version: 1 });
  });

  it("devuelve 404 si el lead no existe y 400 si el id no es válido", async () => {
    const noExiste = await estadoPorApi(999, { estado: "cerrado", version: 1 });
    const idMalo = await estadoPorApi("abc", { estado: "cerrado", version: 1 });

    expect(noExiste.codigo).toBe(404);
    expect(idMalo.codigo).toBe(400);
  });

  describe("permisos", () => {
    it("el agente asignado puede cambiar el estado de su lead", async () => {
      const ana = await crearAgente("Ana");
      const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
      const comoAna = servidorComo(ana, "agente");

      const { codigo } = await estadoPorApi(id, { estado: "contactado", version: 1 }, comoAna);
      await comoAna.close();

      expect(codigo).toBe(200);
    });

    it("un agente no puede cambiar el estado del lead de otro agente", async () => {
      const ana = await crearAgente("Ana");
      const luis = await crearAgente("Luis");
      const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: luis });
      const comoAna = servidorComo(ana, "agente");

      const { codigo } = await estadoPorApi(id, { estado: "cerrado", version: 1 }, comoAna);
      await comoAna.close();

      expect(codigo).toBe(403);
      expect(await leerFila(id)).toMatchObject({ estado: "en_gestion", version: 1 });
    });

    it("el admin puede cambiar el estado del lead de cualquier agente", async () => {
      const luis = await crearAgente("Luis");
      const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: luis });

      const { codigo } = await estadoPorApi(id, { estado: "cerrado", version: 1 });

      expect(codigo).toBe(200);
    });

    it("cualquier agente puede cerrar un lead sin agente", async () => {
      const ana = await crearAgente("Ana");
      const id = await crearLeadConId({ nombre: "Lead" });
      const comoAna = servidorComo(ana, "agente");

      const { codigo, cuerpo } = await estadoPorApi(id, { estado: "cerrado", version: 1 }, comoAna);
      await comoAna.close();

      expect(codigo).toBe(200);
      expect(cuerpo).toMatchObject({ estado: "cerrado", agente: null, version: 2 });
    });

    it("un agente sobre un lead sin agente no recibe 403 sino el motivo del rechazo", async () => {
      const ana = await crearAgente("Ana");
      const id = await crearLeadConId({ nombre: "Lead" });
      const comoAna = servidorComo(ana, "agente");

      const { codigo, cuerpo } = await estadoPorApi(id, { estado: "en_gestion", version: 1 }, comoAna);
      await comoAna.close();

      expect(codigo).toBe(400);
      expect(cuerpo.detalles[0].mensaje).toBe("un lead nuevo solo puede asignarse a un agente o cerrarse");
    });
  });
});

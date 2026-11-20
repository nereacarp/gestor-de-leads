import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { type Lead, crearAgente, editarPorApi, crearLeadConId, leerFila, edicion, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

// tests de PUT /leads/:id
describe("editar un lead", () => {
  it("cambia los datos, sube la versión y recalcula la puntuación", async () => {
    const id = await crearLeadConId({ nombre: "Antiguo", telefono: "600000000" });

    const { codigo, cuerpo } = await editarPorApi(id, edicion(1, { clienteNuevo: true, interes: 5, origen: "recomendacion" }));

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ id, nombre: "Nuevo nombre", prefijo: "34", telefono: "699888777", version: 2 });
    expect(cuerpo.puntuacion).toBe(100);
    expect(new Date(cuerpo.actualizado).getTime()).toBeGreaterThan(new Date(cuerpo.creado).getTime());
    expect(await leerFila(id)).toMatchObject({ nombre: "Nuevo nombre", cliente_nuevo: true, interes: 5, origen: "recomendacion", version: 2 });
  });

  it("deja vacíos el interés y el origen si no se mandan", async () => {
    const id = await crearLeadConId({ nombre: "Lead", interes: 4, origen: "web" });

    const { codigo } = await editarPorApi(id, edicion(1));

    expect(codigo).toBe(200);
    expect(await leerFila(id)).toMatchObject({ interes: null, origen: null, cliente_nuevo: false });
  });

  it("no cambia el estado ni el agente", async () => {
    const ana = await crearAgente("Ana");
    const id = await crearLeadConId({ nombre: "Lead", estado: "contactado", agenteId: ana });

    await editarPorApi(id, edicion(1));

    expect(await leerFila(id)).toMatchObject({ estado: "contactado", agente_id: ana });
  });

  it("devuelve 409 con el lead actual si la versión ya no coincide, y no cambia nada", async () => {
    const id = await crearLeadConId({ nombre: "Original" });
    await editarPorApi(id, edicion(1, { nombre: "Cambio de Ana" }));

    const { codigo, cuerpo } = await editarPorApi(id, edicion(1, { nombre: "Cambio de Luis" }));

    expect(codigo).toBe(409);
    expect(cuerpo.error).toBe("el lead ha sido modificado por otra persona");
    expect(cuerpo.actual).toMatchObject({ id, nombre: "Cambio de Ana", version: 2 });
    expect(await leerFila(id)).toMatchObject({ nombre: "Cambio de Ana", version: 2 });
  });

  it("devuelve 409 también si la versión es mayor que la actual", async () => {
    const id = await crearLeadConId({ nombre: "Lead" });

    const { codigo } = await editarPorApi(id, edicion(5));

    expect(codigo).toBe(409);
    expect(await leerFila(id)).toMatchObject({ version: 1 });
  });

  it("con la versión nueva se puede volver a editar", async () => {
    const id = await crearLeadConId({ nombre: "Lead" });
    const primera = await editarPorApi(id, edicion(1, { nombre: "Uno" }));

    const segunda = await editarPorApi(id, edicion(primera.cuerpo.version, { nombre: "Dos" }));

    expect(segunda.codigo).toBe(200);
    expect(segunda.cuerpo).toMatchObject({ nombre: "Dos", version: 3 });
  });

  it("si dos ediciones llegan a la vez con la misma versión, solo una se guarda", async () => {
    const id = await crearLeadConId({ nombre: "Lead" });

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) => editarPorApi(id, edicion(1, { nombre: `Edición ${i}` }))),
    );

    const codigos = respuestas.map((r) => r.codigo);
    expect(codigos.filter((c) => c === 200)).toHaveLength(1);
    expect(codigos.filter((c) => c === 409)).toHaveLength(9);
    const ganadora = respuestas.find((r) => r.codigo === 200)!;
    expect(await leerFila(id)).toMatchObject({ nombre: ganadora.cuerpo.nombre, version: 2 });
  });

  it.each<[string, unknown]>([
    ["sin versión", { nombre: "Ana", prefijo: "34", telefono: "600123456" }],
    ["con versión 0", { nombre: "Ana", prefijo: "34", telefono: "600123456", version: 0 }],
    ["con la versión como texto", { nombre: "Ana", prefijo: "34", telefono: "600123456", version: "1" }],
    ["sin nombre", { prefijo: "34", telefono: "600123456", version: 1 }],
    ["con un teléfono no válido", { nombre: "Ana", prefijo: "34", telefono: "abc", version: 1 }],
    ["con interés 6", { nombre: "Ana", prefijo: "34", telefono: "600123456", version: 1, interes: 6 }],
    ["con el campo estado", { nombre: "Ana", prefijo: "34", telefono: "600123456", version: 1, estado: "cerrado" }],
    ["con el campo agenteId", { nombre: "Ana", prefijo: "34", telefono: "600123456", version: 1, agenteId: 1 }],
  ])("rechaza editar %s y no cambia nada", async (_descripcion, cuerpo) => {
    const id = await crearLeadConId({ nombre: "Original" });

    const res = await editarPorApi(id, cuerpo);

    expect(res.codigo).toBe(400);
    expect(res.cuerpo.error).toBe("datos no válidos");
    expect(await leerFila(id)).toMatchObject({ nombre: "Original", version: 1 });
  });

  it("devuelve 404 si el lead no existe", async () => {
    const { codigo, cuerpo } = await editarPorApi(999, edicion(1));

    expect(codigo).toBe(404);
    expect(cuerpo.error).toBe("lead no encontrado");
  });

  it.each(["abc", "0", "99999999999"])("devuelve 400 si el id es %s", async (id) => {
    const { codigo, cuerpo } = await editarPorApi(id, edicion(1));

    expect(codigo).toBe(400);
    expect(cuerpo.error).toBe("id no válido");
  });

  describe("permisos", () => {
    // crea un servidor que atiende como el agente indicado
    const como = (id: number, rol: "agente" | "admin") => buildApp(async () => ({ id, nombre: "Usuario", rol }));

    it("el agente asignado puede editar su lead", async () => {
      const ana = await crearAgente("Ana");
      const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: ana });
      const comoAna = como(ana, "agente");

      const { codigo } = await editarPorApi(id, edicion(1), comoAna);
      await comoAna.close();

      expect(codigo).toBe(200);
    });

    it("cualquier agente puede editar un lead sin agente", async () => {
      const ana = await crearAgente("Ana");
      const id = await crearLeadConId({ nombre: "Lead" });
      const comoAna = como(ana, "agente");

      const { codigo } = await editarPorApi(id, edicion(1), comoAna);
      await comoAna.close();

      expect(codigo).toBe(200);
    });

    it("un agente no puede editar el lead de otro agente", async () => {
      const ana = await crearAgente("Ana");
      const luis = await crearAgente("Luis");
      const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: luis });
      const comoAna = como(ana, "agente");

      const { codigo } = await editarPorApi(id, edicion(1), comoAna);
      await comoAna.close();

      expect(codigo).toBe(403);
      expect(await leerFila(id)).toMatchObject({ nombre: "Lead", version: 1 });
    });

    it("el admin puede editar el lead de cualquier agente", async () => {
      const luis = await crearAgente("Luis");
      const id = await crearLeadConId({ nombre: "Lead", estado: "en_gestion", agenteId: luis });

      const { codigo } = await editarPorApi(id, edicion(1));

      expect(codigo).toBe(200);
    });
  });
});

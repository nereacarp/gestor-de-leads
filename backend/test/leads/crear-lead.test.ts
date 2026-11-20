import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { sql } from "../../src/db/sql";
import { type Lead, crearAgente, app, pedir, nombres, crearPorApi, verLead, contarFilas, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

// tests de POST /leads
describe("crear un lead", () => {
  it("crea un lead con solo nombre y teléfono: nuevo, sin agente y con puntuación", async () => {
    const { codigo, cuerpo } = await crearPorApi({ nombre: "Ana Torres", prefijo: "34", telefono: "600123456" });

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ nombre: "Ana Torres", prefijo: "34", telefono: "600123456", estado: "nuevo", agente: null, version: 1 });
    expect(cuerpo.desglose).toHaveLength(4);
    // sin cliente nuevo, interés ni origen solo suma la antigüedad (100 puntos con peso 10)
    expect(cuerpo.puntuacion).toBe(10);
    expect(cuerpo.prioridad).toBe("baja");

    const [fila] = await sql`select cliente_nuevo, interes, origen from leads`;
    expect(fila).toEqual({ cliente_nuevo: false, interes: null, origen: null });
  });

  it("guarda todos los datos y calcula la puntuación máxima", async () => {
    const { codigo, cuerpo } = await crearPorApi({
      nombre: "Luis Pérez",
      prefijo: "34",
      telefono: "600123456",
      clienteNuevo: true,
      interes: 5,
      origen: "recomendacion",
    });

    expect(codigo).toBe(201);
    expect(cuerpo.puntuacion).toBe(100);
    expect(cuerpo.prioridad).toBe("alta");
    expect(cuerpo.desglose.map((c: { valoracion: number }) => c.valoracion)).toEqual([100, 100, 100, 100]);
  });

  it("quita los espacios sobrantes del nombre y del teléfono y guarda el prefijo aparte", async () => {
    const { cuerpo } = await crearPorApi({ nombre: "  Ana  ", prefijo: "44", telefono: "7911 123 456" });

    expect(cuerpo).toMatchObject({ nombre: "Ana", prefijo: "44", telefono: "7911123456" });
    expect(await sql`select prefijo, telefono from leads`).toEqual([{ prefijo: "44", telefono: "7911123456" }]);
  });

  it("el lead creado se puede ver por su id y aparece en el listado", async () => {
    const { cuerpo: creado } = await crearPorApi({ nombre: "Ana", prefijo: "34", telefono: "600123456" });

    const visto = await verLead(creado.id);
    const listado = await pedir();

    expect(visto.cuerpo).toEqual(creado);
    expect(nombres(listado.cuerpo)).toEqual(["Ana"]);
  });

  it.each<[string, unknown]>([
    ["sin nombre", { prefijo: "34", telefono: "600123456" }],
    ["con el nombre vacío", { nombre: "   ", prefijo: "34", telefono: "600123456" }],
    ["sin teléfono", { nombre: "Ana", prefijo: "34" }],
    ["sin prefijo", { nombre: "Ana", telefono: "600123456" }],
    ["con un teléfono con letras", { nombre: "Ana", prefijo: "34", telefono: "abc123456" }],
    ["con un + en el teléfono", { nombre: "Ana", prefijo: "34", telefono: "+600123456" }],
    ["con un prefijo con letras", { nombre: "Ana", prefijo: "es", telefono: "600123456" }],
    ["con un prefijo con +", { nombre: "Ana", prefijo: "+34", telefono: "600123456" }],
    ["con un prefijo de 4 dígitos", { nombre: "Ana", prefijo: "3434", telefono: "600123456" }],
    ["con un teléfono demasiado corto contando el prefijo", { nombre: "Ana", prefijo: "34", telefono: "1234" }],
    ["con un teléfono demasiado largo contando el prefijo", { nombre: "Ana", prefijo: "123", telefono: "1234567890123" }],
    ["con interés 0", { nombre: "Ana", prefijo: "34", telefono: "600123456", interes: 0 }],
    ["con interés 6", { nombre: "Ana", prefijo: "34", telefono: "600123456", interes: 6 }],
    ["con interés con decimales", { nombre: "Ana", prefijo: "34", telefono: "600123456", interes: 2.5 }],
    ["con un origen que no existe", { nombre: "Ana", prefijo: "34", telefono: "600123456", origen: "tele" }],
    ["con clienteNuevo que no es booleano", { nombre: "Ana", prefijo: "34", telefono: "600123456", clienteNuevo: "si" }],
  ])("rechaza un lead %s", async (_descripcion, cuerpo) => {
    const res = await crearPorApi(cuerpo);

    expect(res.codigo).toBe(400);
    expect(res.cuerpo.error).toBe("datos no válidos");
    expect(await contarFilas()).toBe(0);
  });

  it.each(["estado", "puntuacion", "id"])("rechaza el campo %s porque no se puede fijar", async (campo) => {
    const res = await crearPorApi({ nombre: "Ana", prefijo: "34", telefono: "600123456", [campo]: "x" });

    expect(res.codigo).toBe(400);
    expect(res.cuerpo.detalles).toEqual([{ campo, mensaje: "campo no permitido" }]);
    expect(await contarFilas()).toBe(0);
  });

  it("el admin crea un lead asignado a un agente y nace en gestión", async () => {
    const ana = await crearAgente("Ana");

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456", agenteId: ana });

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana, nombre: "Ana" } });
  });

  it("un agente puede crear un lead asignado a sí mismo", async () => {
    const ana = await crearAgente("Ana");
    const comoAna = buildApp(async () => ({ id: ana, nombre: "Ana", rol: "agente" }));

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456", agenteId: ana }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana } });
  });

  it("un agente no puede crear un lead asignado a otro agente", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const comoAna = buildApp(async () => ({ id: ana, nombre: "Ana", rol: "agente" }));

    const { codigo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456", agenteId: luis }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(403);
    expect(await contarFilas()).toBe(0);
  });

  it("un agente puede crear un lead sin agente", async () => {
    const ana = await crearAgente("Ana");
    const comoAna = buildApp(async () => ({ id: ana, nombre: "Ana", rol: "agente" }));

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456" }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ estado: "nuevo", agente: null });
  });

  it("rechaza un agente que no existe", async () => {
    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456", agenteId: 999 });

    expect(codigo).toBe(400);
    expect(cuerpo.detalles).toEqual([{ campo: "agenteId", mensaje: "el agente no existe" }]);
    expect(await contarFilas()).toBe(0);
  });

  it("rechaza asignar el lead a un administrador", async () => {
    const [{ id: admin }] = await sql<{ id: number }[]>`
      insert into agentes (nombre, rol, token) values ('Jefa', 'admin', 'token-jefa') returning id
    `;

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456", agenteId: admin });

    expect(codigo).toBe(400);
    expect(cuerpo.detalles[0].mensaje).toBe("no se pueden asignar leads a un administrador");
    expect(await contarFilas()).toBe(0);
  });

  it.each([0, -1, 1.5, "1"])("rechaza un agenteId no válido (%s)", async (agenteId) => {
    const { codigo } = await crearPorApi({ nombre: "Lead", prefijo: "34", telefono: "600123456", agenteId });

    expect(codigo).toBe(400);
    expect(await contarFilas()).toBe(0);
  });

  it("rechaza una petición sin cuerpo", async () => {
    const res = await app.inject({ method: "POST", url: "/leads", headers: { authorization: "Bearer prueba" } });

    expect(res.statusCode).toBe(400);
    expect(await contarFilas()).toBe(0);
  });

  it("rechaza una petición sin token", async () => {
    const sinPermiso = buildApp(async () => null);

    const res = await sinPermiso.inject({ method: "POST", url: "/leads", payload: { nombre: "Ana", prefijo: "34", telefono: "600123456" } });
    await sinPermiso.close();

    expect(res.statusCode).toBe(401);
    expect(await contarFilas()).toBe(0);
  });

  it("no se deja engañar por un texto de inyección SQL en el nombre", async () => {
    const nombre = "Robert'); drop table leads;--";

    const { codigo, cuerpo } = await crearPorApi({ nombre, prefijo: "34", telefono: "600123456" });

    expect(codigo).toBe(201);
    expect(cuerpo.nombre).toBe(nombre);
    expect(await contarFilas()).toBe(1);
  });
});

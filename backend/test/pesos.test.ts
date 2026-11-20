import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { Agente } from "../src/auth";
import { sql } from "../src/db/sql";
import { prepararBaseDeDatos, vaciarTablas } from "./base-de-datos";

// define los usuarios de prueba según el token que envíen
const usuarios: Record<string, Agente> = {
  admin: { id: 1, nombre: "Admin de prueba", rol: "admin" },
  agente: { id: 2, nombre: "Agente de prueba", rol: "agente" },
};

// construye la lista de pesos con los 4 criterios en orden
const lista = (cliente: number, interes: number, origen: number, antiguedad: number) => [
  { criterio: "cliente_nuevo", peso: cliente },
  { criterio: "interes", peso: interes },
  { criterio: "origen", peso: origen },
  { criterio: "antiguedad", peso: antiguedad },
];

// pesos con los que empieza la base de datos
const PESOS_INICIALES = lista(40, 30, 20, 10);

// declara la variable app que contendrá el servidor
let app: ReturnType<typeof buildApp>;

// hace una petición a /pesos con el token indicado (por defecto el del admin)
async function pedir(metodo: "GET" | "PUT", token = "admin", cuerpo?: object) {
  const res = await app.inject({
    method: metodo,
    url: "/pesos",
    headers: { authorization: `Bearer ${token}` },
    payload: cuerpo,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// preparan los tests
beforeAll(async () => { // crea la base de datos y el servidor con un admin y un agente de prueba
  await prepararBaseDeDatos();
  app = buildApp(async (token) => usuarios[token] ?? null);
}, 30000);

beforeEach(async () => { // vacía las tablas y restablece los pesos iniciales
  await vaciarTablas();
});

afterAll(async () => { // cierra el servidor y la conexión a la base de datos
  await app.close();
  await sql.end();
});

// tests de quién puede usar las rutas GET y PUT /pesos
describe("permisos", () => {
  it("devuelve los pesos iniciales al admin", async () => {
    const { codigo, cuerpo } = await pedir("GET");

    expect(codigo).toBe(200);
    expect(cuerpo.datos).toEqual(PESOS_INICIALES);
  });

  it("responde 403 a un agente que no es admin, y no cambia los pesos", async () => {
    const lectura = await pedir("GET", "agente");
    const cambio = await pedir("PUT", "agente", lista(10, 20, 30, 40));
    const despues = await pedir("GET");

    expect(lectura.codigo).toBe(403);
    expect(cambio.codigo).toBe(403);
    expect(despues.cuerpo.datos).toEqual(PESOS_INICIALES);
  });

  it("responde 401 sin un token válido", async () => {
    const sinPermiso = buildApp(async () => null); // servidor donde ningún token es válido

    const res = await sinPermiso.inject({ method: "GET", url: "/pesos" });
    await sinPermiso.close();

    expect(res.statusCode).toBe(401);
  });
});

// tests de que se guardan los pesos válidos y se reflejan en la puntuación
describe("cambio de pesos", () => {
  it("guarda unos pesos válidos y los devuelve", async () => {
    const cambio = await pedir("PUT", "admin", lista(10, 20, 30, 40));
    const despues = await pedir("GET");

    expect(cambio.codigo).toBe(200);
    expect(cambio.cuerpo.datos).toEqual(lista(10, 20, 30, 40));
    expect(despues.cuerpo.datos).toEqual(lista(10, 20, 30, 40));
  });

  it("acepta los límites: un peso de 0 y un peso de 100", async () => {
    const { codigo, cuerpo } = await pedir("PUT", "admin", lista(100, 0, 0, 0));

    expect(codigo).toBe(200);
    expect(cuerpo.datos).toEqual(lista(100, 0, 0, 0));
  });

  it("se refleja en la puntuación del listado de leads", async () => {
    await sql`
      insert into leads (nombre, prefijo, telefono, estado, cliente_nuevo, created_at, updated_at)
      values ('Lead', '34', '600000000', 'nuevo', true, now(), now())
    `;
    // devuelve la puntuación del primer lead del listado
    const pedirLeads = async () => {
      const res = await app.inject({
        method: "GET",
        url: "/leads",
        headers: { authorization: "Bearer admin" },
      });
      return res.json().datos[0].puntuacion;
    };

    const antes = await pedirLeads(); // 40 por cliente nuevo y 10 por antigüedad
    await pedir("PUT", "admin", lista(100, 0, 0, 0));
    const despues = await pedirLeads();

    expect(antes).toBeCloseTo(50, 0);
    expect(despues).toBe(100);
  });
});

// tests de que se rechazan los pesos no válidos sin cambiar nada
describe("pesos no válidos", () => {
  // cada caso es una descripción y el cuerpo no válido que se envía
  it.each([
    ["suman menos de 100", lista(10, 20, 30, 30)],
    ["suman más de 100", lista(50, 30, 20, 10)],
    ["un peso negativo", lista(-10, 50, 30, 30)],
    ["un peso con decimales", lista(40.5, 29.5, 20, 10)],
    ["un criterio repetido", [
      { criterio: "cliente_nuevo", peso: 40 },
      { criterio: "interes", peso: 30 },
      { criterio: "interes", peso: 20 },
      { criterio: "origen", peso: 10 },
    ]],
    ["falta un criterio", lista(50, 30, 20, 0).slice(0, 3)],
    ["un criterio desconocido", [...lista(40, 30, 20, 0), { criterio: "color", peso: 10 }].slice(1)],
    ["una lista vacía", []],
    ["algo que no es una lista", { cliente_nuevo: 100 }],
    ["un peso que no es un número", [{ criterio: "cliente_nuevo", peso: "40" }, ...lista(0, 30, 20, 10).slice(1)]],
  ])("responde 400 con %s y no cambia los pesos", async (_descripcion, cuerpo) => {
    const respuesta = await pedir("PUT", "admin", cuerpo);
    const despues = await pedir("GET");

    expect(respuesta.codigo).toBe(400);
    expect(respuesta.cuerpo.error).toBe("pesos no válidos");
    expect(respuesta.cuerpo.detalles.length).toBeGreaterThan(0);
    expect(despues.cuerpo.datos).toEqual(PESOS_INICIALES);
  });
});

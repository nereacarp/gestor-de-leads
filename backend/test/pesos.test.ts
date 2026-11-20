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

// tests de que cada respuesta usa un único juego de pesos aunque el admin los cambie a la vez que otros consultan
describe("consistencia al cambiar los pesos mientras otros consultan", () => {
  it("cada respuesta usa un juego de pesos completo y su puntuación coincide con él", async () => {
    // dos leads con valoraciones opuestas: el primero vale 100 en cliente nuevo y 0 en antigüedad, y el segundo al revés
    await sql`
      insert into leads (nombre, prefijo, telefono, estado, cliente_nuevo, created_at, updated_at) values
        ('Cliente nuevo antiguo', '34', '600000001', 'nuevo', true, now() - interval '90 days', now()),
        ('Cliente viejo reciente', '34', '600000002', 'nuevo', false, now(), now())
    `;
    // con A solo cuenta el cliente nuevo y con B solo la antigüedad, así que la suma de las dos notas es siempre 100
    const A = lista(100, 0, 0, 0);
    const B = lista(0, 0, 0, 100);
    const pesosDe = (desglose: { peso: number }[]) => desglose.map((c) => c.peso);

    // se parte de B para que ninguna lectura vea los pesos iniciales
    await pedir("PUT", "admin", B);

    // lanza 30 cambios de pesos (alternando A y B), 30 listados y 30 lecturas de pesos a la vez
    const peticiones = [
      ...Array.from({ length: 30 }, (_, i) => pedir("PUT", "admin", i % 2 === 0 ? A : B).then((r) => ({ tipo: "cambio" as const, ...r }))),
      ...Array.from({ length: 30 }, () =>
        app
          .inject({ method: "GET", url: "/leads", headers: { authorization: "Bearer admin" } })
          .then((res) => ({ tipo: "listado" as const, codigo: res.statusCode, cuerpo: res.json() })),
      ),
      ...Array.from({ length: 30 }, () => pedir("GET").then((r) => ({ tipo: "pesos" as const, ...r }))),
    ];
    const respuestas = await Promise.all(peticiones);

    // todas las respuestas son correctas
    expect(respuestas.every((r) => r.codigo === 200)).toBe(true);

    for (const r of respuestas) {
      // los pesos que se leen son exactamente A o B, nunca una mezcla
      if (r.tipo === "pesos") expect([A, B]).toContainEqual(r.cuerpo.datos);

      if (r.tipo === "listado") {
        const [primero, segundo] = r.cuerpo.datos as { puntuacion: number; desglose: { peso: number }[] }[];
        const pesos = pesosDe(primero.desglose);
        // los dos leads se calculan con los mismos pesos y son A o B
        expect(pesosDe(segundo.desglose)).toEqual(pesos);
        expect([[100, 0, 0, 0], [0, 0, 0, 100]]).toContainEqual(pesos);
        // la puntuación coincide con esos pesos y la suma de las dos notas es 100
        expect(primero.puntuacion + segundo.puntuacion).toBeCloseTo(100, 0);
      }
    }

    // al terminar quedan guardados unos pesos completos que suman 100
    const final = await pedir("GET");
    expect([A, B]).toContainEqual(final.cuerpo.datos);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { sql } from "../src/db/sql";
import { prepararBaseDeDatos, vaciarTablas } from "./base-de-datos";

// describe un agente que figura en la respuesta
type Agente = { id: number; nombre: string; rol: string };

// declara la variable app que contendrá el servidor
let app: ReturnType<typeof buildApp>;

// hace una petición a /agentes como un usuario autenticado
async function pedir(parametros = "") {
  const res = await app.inject({
    method: "GET",
    url: `/agentes${parametros}`,
    headers: { authorization: "Bearer prueba" },
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// preparan los tests
beforeAll(async () => { // crea la base de datos y el servidor con un agente de prueba
  await prepararBaseDeDatos();
  app = buildApp(async () => ({ id: 1, nombre: "Agente de prueba", rol: "agente" }));
}, 30000);

beforeEach(async () => { // vacía las tablas y crea tres agentes para que cada test empiece igual
  await vaciarTablas();
  await sql`
    insert into agentes (nombre, rol, token) values
      ('Admin', 'admin', 'token-admin'),
      ('Ana', 'agente', 'token-ana'),
      ('Luis', 'agente', 'token-luis')
  `;
});

afterAll(async () => { // cierra el servidor y la conexión a la base de datos
  await app.close();
  await sql.end();
});

// tests de la ruta GET /agentes
describe("GET /agentes", () => {
  it("devuelve todos los agentes, admin incluido, ordenados por id", async () => {
    const { codigo, cuerpo } = await pedir();

    expect(codigo).toBe(200);
    expect(cuerpo.datos.map((a: Agente) => a.nombre)).toEqual(["Admin", "Ana", "Luis"]);
    expect(cuerpo.datos[0].rol).toBe("admin");
  });

  it("no devuelve nunca el token", async () => {
    const { cuerpo } = await pedir();

    for (const agente of cuerpo.datos) {
      expect(Object.keys(agente).sort()).toEqual(["id", "nombre", "rol"]);
    }
  });

  it("filtra por rol", async () => {
    const agentes = await pedir("?rol=agente");
    const admins = await pedir("?rol=admin");

    expect(agentes.cuerpo.datos.map((a: Agente) => a.nombre)).toEqual(["Ana", "Luis"]);
    expect(admins.cuerpo.datos.map((a: Agente) => a.nombre)).toEqual(["Admin"]);
  });

  it("responde 400 con un rol que no existe", async () => {
    const { codigo, cuerpo } = await pedir("?rol=jefe");

    expect(codigo).toBe(400);
    expect(cuerpo.error).toBe("parámetros no válidos");
  });

  it("responde 401 sin un token válido", async () => {
    const sinPermiso = buildApp(async () => null);

    const res = await sinPermiso.inject({ method: "GET", url: "/agentes" });
    await sinPermiso.close();

    expect(res.statusCode).toBe(401);
  });
});

import { afterAll, beforeAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app";
import { sql } from "../../src/db/sql";
import { prepararBaseDeDatos, vaciarTablas } from "../base-de-datos";

// milisegundos que tiene un día
export const DIA_MS = 24 * 60 * 60 * 1000;

// días a partir de los cuales la antigüedad vale 0
// tiene que coincidir con dias_max_antiguedad de db/schema.sql
export const DIAS_MAX_ANTIGUEDAD = 90;

// describe el lead tal como lo devuelve la api
export type Lead = {
  id: number;
  nombre: string;
  estado: string;
  creado: string;
  agente: { id: number; nombre: string } | null;
  puntuacion: number;
  prioridad: string;
  desglose: { criterio: string; valoracion: number; peso: number; aporte: number }[];
};

// describe los datos de un lead de prueba
export type DatosLead = {
  nombre: string;
  prefijo?: string;
  telefono?: string;
  estado?: string;
  agenteId?: number | null;
  clienteNuevo?: boolean;
  interes?: number | null;
  origen?: string | null;
  // solo en pruebas para fijar la fecha de creación relativa
  dias?: number;
  creado?: Date;
};

// crea un agente y devuelve su id
export async function crearAgente(nombre: string) {
  const [fila] = await sql<{ id: number }[]>`
    insert into agentes (nombre, rol, token) values (${nombre}, 'agente', ${"token-" + nombre})
    returning id
  `;
  return fila.id;
}

// crea un lead con una fecha de creación relativa
export async function crearLead(datos: DatosLead) {
  const d = {
    prefijo: "34",
    telefono: "600000000",
    estado: "nuevo",
    agenteId: null,
    clienteNuevo: false,
    interes: null,
    origen: null,
    dias: 0,
    ...datos,
  };
  const creado = d.creado ?? new Date(Date.now() - d.dias * DIA_MS);
  await sql`
    insert into leads (nombre, prefijo, telefono, estado, agente_id, cliente_nuevo, interes, origen, created_at, updated_at)
    values (${d.nombre}, ${d.prefijo}, ${d.telefono}, ${d.estado}, ${d.agenteId}, ${d.clienteNuevo},
            ${d.interes}, ${d.origen}, ${creado}, ${creado})
  `;
}

// cambia los pesos (sumando siempre 100)
export async function ponerPesos(p: { cliente: number; interes: number; origen: number; antiguedad: number }) {
  await sql`
    update pesos
    set peso_cliente_nuevo = ${p.cliente}, peso_interes = ${p.interes},
        peso_origen = ${p.origen}, peso_antiguedad = ${p.antiguedad}
  `;
}

// declara la variable app que contendrá el servidor
export let app: ReturnType<typeof buildApp>;

// hace una petición a /leads como un usuario autenticado
export async function pedir(parametros = "") {
  const res = await app.inject({
    method: "GET",
    url: `/leads${parametros}`,
    headers: { authorization: "Bearer prueba" },
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// saca los nombres de los leads de una respuesta en orden
export const nombres = (cuerpo: { datos: Lead[] }) => cuerpo.datos.map((l) => l.nombre);

// hace una petición POST /leads como un usuario autenticado (por defecto, como el admin de prueba)
export async function crearPorApi(cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "POST",
    url: "/leads",
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// hace una petición GET /leads/:id como un usuario autenticado
export async function verLead(id: number | string) {
  const res = await app.inject({
    method: "GET",
    url: `/leads/${id}`,
    headers: { authorization: "Bearer prueba" },
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// cuenta los leads que hay en la base de datos
export async function contarFilas() {
  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from leads`;
  return total;
}



// hace una petición PUT /leads/:id como un usuario autenticado (por defecto, como el admin de prueba)
export async function editarPorApi(id: number | string, cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "PUT",
    url: `/leads/${id}`,
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// crea un lead en la base de datos y devuelve su id
export async function crearLeadConId(datos: DatosLead) {
  await crearLead(datos);
  const [{ id }] = await sql<{ id: number }[]>`select max(id)::int as id from leads`;
  return id;
}

// lee de la base de datos los datos y la versión de un lead
export async function leerFila(id: number) {
  const [fila] = await sql`
    select nombre, telefono, cliente_nuevo, interes, origen, estado, agente_id, version from leads where id = ${id}
  `;
  return fila;
}

// datos válidos para editar un lead (con la versión que vio el cliente)
export const edicion = (version: number, resto = {}) => ({ nombre: "Nuevo nombre", prefijo: "34", telefono: "699888777", version, ...resto });


// crea un servidor que atiende como el usuario indicado
export const servidorComo = (id: number, rol: "agente" | "admin") => buildApp(async () => ({ id, nombre: "Usuario", rol }));

// hace una petición POST a /leads/:id/asignar o /leads/:id/liberar
export async function accionPorApi(accion: "asignar" | "liberar", id: number | string, cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "POST",
    url: `/leads/${id}/${accion}`,
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}
export const asignarPorApi = (id: number | string, cuerpo: unknown, servidor = app) => accionPorApi("asignar", id, cuerpo, servidor);
export const liberarPorApi = (id: number | string, cuerpo: unknown, servidor = app) => accionPorApi("liberar", id, cuerpo, servidor);



// hace una petición PUT /leads/:id/estado como un usuario autenticado (por defecto, como el admin de prueba)
export async function estadoPorApi(id: number | string, cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "PUT",
    url: `/leads/${id}/estado`,
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// registra la base de datos, el servidor y la limpieza de tablas de los tests de un archivo
export function prepararTests() {
  beforeAll(async () => { // crea la base de datos y el servidor con un agente de prueba
    await prepararBaseDeDatos();
    app = buildApp(async () => ({ id: 1, nombre: "Admin", rol: "admin" }));
  }, 30000);

  beforeEach(async () => { // vacía las tablas para que cada test empiece limpio
    await vaciarTablas();
  });

  afterAll(async () => { // cierra el servidor y la conexión a la base de datos
    await app.close();
    await sql.end();
  });
}

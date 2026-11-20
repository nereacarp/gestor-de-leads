import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { sql } from "../src/db/sql";
import { prepararBaseDeDatos, vaciarTablas } from "./base-de-datos";

// milisegundos que tiene un día
const DIA_MS = 24 * 60 * 60 * 1000;

// días a partir de los cuales la antigüedad vale 0
// tiene que coincidir con dias_max_antiguedad de db/schema.sql
const DIAS_MAX_ANTIGUEDAD = 90;

// describe el lead tal como lo devuelve la api
type Lead = {
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
type DatosLead = {
  nombre: string;
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
async function crearAgente(nombre: string) {
  const [fila] = await sql<{ id: number }[]>`
    insert into agentes (nombre, rol, token) values (${nombre}, 'agente', ${"token-" + nombre})
    returning id
  `;
  return fila.id;
}

// crea un lead con una fecha de creación relativa
async function crearLead(datos: DatosLead) {
  const d = {
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
    insert into leads (nombre, telefono, estado, agente_id, cliente_nuevo, interes, origen, created_at, updated_at)
    values (${d.nombre}, ${d.telefono}, ${d.estado}, ${d.agenteId}, ${d.clienteNuevo},
            ${d.interes}, ${d.origen}, ${creado}, ${creado})
  `;
}

// cambia los pesos (sumando siempre 100)
async function ponerPesos(p: { cliente: number; interes: number; origen: number; antiguedad: number }) {
  await sql`
    update pesos
    set peso_cliente_nuevo = ${p.cliente}, peso_interes = ${p.interes},
        peso_origen = ${p.origen}, peso_antiguedad = ${p.antiguedad}
  `;
}

// declara la variable app que contendrá el servidor
let app: ReturnType<typeof buildApp>;

// hace una petición a /leads como un usuario autenticado
async function pedir(parametros = "") {
  const res = await app.inject({
    method: "GET",
    url: `/leads${parametros}`,
    headers: { authorization: "Bearer prueba" },
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// saca los nombres de los leads de una respuesta en orden
const nombres = (cuerpo: { datos: Lead[] }) => cuerpo.datos.map((l) => l.nombre);

// preparan los tests
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

// tests de la puntuación y el orden de GET /leads
describe("puntuación y orden", () => {
  it("ordena los leads de mayor a menor puntuación", async () => {
    await crearLead({ nombre: "Baja", interes: 1, origen: "llamada", dias: DIAS_MAX_ANTIGUEDAD });
    await crearLead({ nombre: "Alta", clienteNuevo: true, interes: 5, origen: "recomendacion" });
    await crearLead({ nombre: "Media", interes: 3, origen: "web", dias: DIAS_MAX_ANTIGUEDAD / 2 });

    const { cuerpo } = await pedir();

    expect(nombres(cuerpo)).toEqual(["Alta", "Media", "Baja"]);
    expect(cuerpo.datos[0].puntuacion).toBeCloseTo(100, 0);
    expect(cuerpo.datos[1].puntuacion).toBeCloseTo(34, 0);
    expect(cuerpo.datos[2].puntuacion).toBeCloseTo(4, 0);
  });

  it("desempata por id, no por nombre, y el orden es siempre el mismo", async () => {
    const fecha = new Date(Date.now() - 45 * DIA_MS); // misma fecha = misma puntuación exacta
    await crearLead({ nombre: "Zeta", creado: fecha });
    await crearLead({ nombre: "Alba", creado: fecha });

    const primera = await pedir();
    const segunda = await pedir();

    expect(primera.cuerpo.datos[0].puntuacion).toBe(primera.cuerpo.datos[1].puntuacion);
    expect(nombres(primera.cuerpo)).toEqual(["Zeta", "Alba"]);
    expect(nombres(segunda.cuerpo)).toEqual(["Zeta", "Alba"]);
  });

  it("calcula la prioridad con los límites 75 (alta) y 40 (media)", async () => {
    await ponerPesos({ cliente: 0, interes: 100, origen: 0, antiguedad: 0 });
    await crearLead({ nombre: "i4", interes: 4 }); // 75
    await crearLead({ nombre: "i3", interes: 3 }); // 50
    await crearLead({ nombre: "i2", interes: 2 }); // 25
    const interes = await pedir();

    await ponerPesos({ cliente: 0, interes: 0, origen: 100, antiguedad: 0 });
    await crearLead({ nombre: "o-recomendacion", origen: "recomendacion" }); // 100
    await crearLead({ nombre: "o-anuncio", origen: "anuncio" }); // 40
    await crearLead({ nombre: "o-llamada", origen: "llamada" }); // 20
    const origen = await pedir("?q=o-");

    const prioridad = (c: { datos: Lead[] }, nombre: string) =>
      c.datos.find((l) => l.nombre === nombre)?.prioridad;
    expect(prioridad(interes.cuerpo, "i4")).toBe("alta");
    expect(prioridad(interes.cuerpo, "i3")).toBe("media");
    expect(prioridad(interes.cuerpo, "i2")).toBe("baja");
    expect(prioridad(origen.cuerpo, "o-recomendacion")).toBe("alta");
    expect(prioridad(origen.cuerpo, "o-anuncio")).toBe("media");
    expect(prioridad(origen.cuerpo, "o-llamada")).toBe("baja");
  });

  it("valora con 0 el interés y el origen ausentes", async () => {
    await ponerPesos({ cliente: 0, interes: 50, origen: 50, antiguedad: 0 });
    await crearLead({ nombre: "Sin datos" });

    const { cuerpo } = await pedir();
    const lead: Lead = cuerpo.datos[0];

    expect(lead.puntuacion).toBe(0);
    expect(lead.desglose.find((c) => c.criterio === "Interés comercial")?.valoracion).toBe(0);
    expect(lead.desglose.find((c) => c.criterio === "Origen del lead")?.valoracion).toBe(0);
  });

  it("calcula la antigüedad: 100 hoy, 50 a la mitad de los días máximos y 0 desde el máximo", async () => {
    await ponerPesos({ cliente: 0, interes: 0, origen: 0, antiguedad: 100 });
    await crearLead({ nombre: "hoy", dias: 0 });
    await crearLead({ nombre: "mitad", dias: DIAS_MAX_ANTIGUEDAD / 2 });
    await crearLead({ nombre: "maximo", dias: DIAS_MAX_ANTIGUEDAD });
    await crearLead({ nombre: "doble", dias: DIAS_MAX_ANTIGUEDAD * 2 });

    const { cuerpo } = await pedir();
    const nota = (nombre: string) => cuerpo.datos.find((l: Lead) => l.nombre === nombre).puntuacion;

    expect(nota("hoy")).toBeCloseTo(100, 0);
    expect(nota("mitad")).toBeCloseTo(50, 0);
    expect(nota("maximo")).toBe(0);
    expect(nota("doble")).toBe(0);
  });

  it("devuelve un desglose cuya suma es la puntuación", async () => {
    await crearLead({ nombre: "Lead", interes: 3, origen: "web", dias: 45 });

    const { cuerpo } = await pedir();
    const lead: Lead = cuerpo.datos[0];

    expect(lead.desglose.map((c) => c.criterio)).toEqual([
      "Cliente nuevo",
      "Interés comercial",
      "Origen del lead",
      "Antigüedad",
    ]);
    expect(new Date(lead.creado).getTime()).toBeLessThan(Date.now());
    expect(lead.desglose.map((c) => c.peso)).toEqual([40, 30, 20, 10]);
    expect(lead.desglose.map((c) => c.valoracion)[1]).toBe(50);
    expect(lead.desglose.map((c) => c.valoracion)[2]).toBe(70);
    const suma = lead.desglose.reduce((total, c) => total + c.aporte, 0);
    expect(suma).toBeCloseTo(lead.puntuacion, 0);
  });

  it("refleja un cambio de pesos en la puntuación y en el orden", async () => {
    await crearLead({ nombre: "Cliente", clienteNuevo: true, dias: DIAS_MAX_ANTIGUEDAD }); // 40 con los pesos iniciales
    await crearLead({ nombre: "Interes", interes: 5, origen: "recomendacion", dias: DIAS_MAX_ANTIGUEDAD }); // 50

    const antes = await pedir();
    await ponerPesos({ cliente: 100, interes: 0, origen: 0, antiguedad: 0 });
    const despues = await pedir();

    expect(nombres(antes.cuerpo)).toEqual(["Interes", "Cliente"]);
    expect(nombres(despues.cuerpo)).toEqual(["Cliente", "Interes"]);
    expect(despues.cuerpo.datos[0].puntuacion).toBe(100);
    expect(despues.cuerpo.datos[1].puntuacion).toBe(0);
  });
});

// tests de los filtros y la búsqueda de GET /leads
describe("filtros y búsqueda", () => {
  it("filtra por estado", async () => {
    const ana = await crearAgente("Ana");
    await crearLead({ nombre: "A", estado: "nuevo" });
    await crearLead({ nombre: "B", estado: "contactado", agenteId: ana });
    await crearLead({ nombre: "C", estado: "cerrado" });

    const { cuerpo } = await pedir("?estado=contactado");

    expect(nombres(cuerpo)).toEqual(["B"]);
    expect(cuerpo.total).toBe(1);
  });

  it("filtra por agente y por leads sin agente, y devuelve el agente", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    await crearLead({ nombre: "De Ana 1", agenteId: ana, estado: "en_gestion" });
    await crearLead({ nombre: "De Ana 2", agenteId: ana, estado: "en_gestion" });
    await crearLead({ nombre: "De Luis", agenteId: luis, estado: "contactado" });
    await crearLead({ nombre: "Sin agente" });

    const deAna = await pedir(`?agente=${ana}`);
    const sinAgente = await pedir("?agente=sin");

    expect(nombres(deAna.cuerpo).sort()).toEqual(["De Ana 1", "De Ana 2"]);
    expect(deAna.cuerpo.datos[0].agente).toEqual({ id: ana, nombre: "Ana" });
    expect(nombres(sinAgente.cuerpo)).toEqual(["Sin agente"]);
    expect(sinAgente.cuerpo.datos[0].agente).toBeNull();
  });

  it("combina filtros", async () => {
    const ana = await crearAgente("Ana");
    await crearLead({ nombre: "Uno", agenteId: ana, estado: "en_gestion" });
    await crearLead({ nombre: "Dos", agenteId: ana, estado: "contactado" });

    const { cuerpo } = await pedir(`?agente=${ana}&estado=contactado`);

    expect(nombres(cuerpo)).toEqual(["Dos"]);
  });

  it("busca por nombre (sin distinguir mayúsculas) y por teléfono", async () => {
    await crearLead({ nombre: "Ana Torres", telefono: "611111111" });
    await crearLead({ nombre: "Luis Pérez", telefono: "622222222" });

    const porNombre = await pedir("?q=ANA");
    const porTilde = await pedir(`?q=${encodeURIComponent("pérez")}`);
    const porTelefono = await pedir("?q=6222");

    expect(nombres(porNombre.cuerpo)).toEqual(["Ana Torres"]);
    expect(nombres(porTilde.cuerpo)).toEqual(["Luis Pérez"]);
    expect(nombres(porTelefono.cuerpo)).toEqual(["Luis Pérez"]);
  });

  it("busca % y _ como texto normal, no como comodines", async () => {
    await crearLead({ nombre: "Oferta 100%" });
    await crearLead({ nombre: "Otro lead" });

    const porcentaje = await pedir(`?q=${encodeURIComponent("%")}`);
    const guion = await pedir(`?q=${encodeURIComponent("_")}`);

    expect(nombres(porcentaje.cuerpo)).toEqual(["Oferta 100%"]);
    expect(guion.cuerpo.total).toBe(0);
  });

  it("no se deja engañar por un texto de inyección SQL", async () => {
    await crearLead({ nombre: "Ana" });
    await crearLead({ nombre: "Luis" });

    const { codigo, cuerpo } = await pedir(`?q=${encodeURIComponent("x'or'1'='1")}`);

    expect(codigo).toBe(200);
    expect(cuerpo.total).toBe(0);
  });

  it("trata una búsqueda vacía como si no hubiera búsqueda", async () => {
    await crearLead({ nombre: "Ana" });
    await crearLead({ nombre: "Luis" });

    const { cuerpo } = await pedir("?q=");

    expect(cuerpo.total).toBe(2);
  });
});

// tests de la paginación y el total de GET /leads
describe("paginación", () => {
  beforeEach(async () => { // se crean cinco leads con puntuaciones distintas
    for (const interes of [1, 2, 3, 4, 5]) {
      await crearLead({ nombre: `L${interes}`, interes, dias: DIAS_MAX_ANTIGUEDAD });
    }
  });

  it("devuelve cada página y el total", async () => {
    const primera = await pedir("?limite=2&pagina=1");
    const segunda = await pedir("?limite=2&pagina=2");
    const tercera = await pedir("?limite=2&pagina=3");

    expect(nombres(primera.cuerpo)).toEqual(["L5", "L4"]);
    expect(nombres(segunda.cuerpo)).toEqual(["L3", "L2"]);
    expect(nombres(tercera.cuerpo)).toEqual(["L1"]);
    for (const { cuerpo } of [primera, segunda, tercera]) {
      expect(cuerpo.total).toBe(5);
      expect(cuerpo.limite).toBe(2);
    }
    expect(primera.cuerpo.pagina).toBe(1);
  });

  it("devuelve una lista vacía con el total correcto si la página no existe", async () => {
    const { codigo, cuerpo } = await pedir("?limite=2&pagina=9");

    expect(codigo).toBe(200);
    expect(cuerpo.datos).toEqual([]);
    expect(cuerpo.total).toBe(5);
  });

  it("usa la página 1 y 20 leads por defecto", async () => {
    const { cuerpo } = await pedir();

    expect(cuerpo.pagina).toBe(1);
    expect(cuerpo.limite).toBe(20);
    expect(cuerpo.datos).toHaveLength(5);
  });
});

// tests de los errores de GET /leads: parámetros no válidos y falta de token
describe("errores", () => {
  it.each([
    ["estado desconocido", "?estado=cualquiera"],
    ["página 0", "?pagina=0"],
    ["página negativa", "?pagina=-3"],
    ["límite 0", "?limite=0"],
    ["límite demasiado grande", "?limite=101"],
    ["agente que no es un número", "?agente=abc"],
    ["agente 0", "?agente=0"],
  ])("responde 400 con %s", async (_descripcion, parametros) => {
    const { codigo, cuerpo } = await pedir(parametros);

    expect(codigo).toBe(400);
    expect(cuerpo.error).toBe("parámetros no válidos");
    expect(cuerpo.detalles.length).toBeGreaterThan(0);
  });

  it("responde 401 sin un token válido", async () => {
    const sinPermiso = buildApp(async () => null);

    const res = await sinPermiso.inject({ method: "GET", url: "/leads" });
    await sinPermiso.close();

    expect(res.statusCode).toBe(401);
  });
});

// tests de la regla de la base de datos: solo los leads nuevos y cerrados pueden no tener agente
describe("coherencia entre estado y agente", () => {
  it.each<[string, string, boolean]>([
    ["un lead nuevo sin agente", "nuevo", false],
    ["un lead cerrado sin agente", "cerrado", false],
    ["un lead cerrado con agente", "cerrado", true],
    ["un lead en gestión con agente", "en_gestion", true],
    ["un lead contactado con agente", "contactado", true],
  ])("acepta %s", async (_descripcion, estado, conAgente) => {
    const agenteId = conAgente ? await crearAgente("Ana") : null;

    await expect(crearLead({ nombre: "Lead", estado, agenteId })).resolves.toBeUndefined();
  });

  it.each<[string, string, boolean]>([
    ["un lead en gestión sin agente", "en_gestion", false],
    ["un lead contactado sin agente", "contactado", false],
  ])("rechaza %s", async (_descripcion, estado, conAgente) => {
    const agenteId = conAgente ? await crearAgente("Ana") : null;

    await expect(crearLead({ nombre: "Lead", estado, agenteId })).rejects.toThrow(/leads_estado_agente_check/);
  });
});

// hace una petición POST /leads como un usuario autenticado (por defecto, como el admin de prueba)
async function crearPorApi(cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "POST",
    url: "/leads",
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// hace una petición GET /leads/:id como un usuario autenticado
async function verLead(id: number | string) {
  const res = await app.inject({
    method: "GET",
    url: `/leads/${id}`,
    headers: { authorization: "Bearer prueba" },
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// cuenta los leads que hay en la base de datos
async function contarFilas() {
  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from leads`;
  return total;
}

// tests de POST /leads
describe("crear un lead", () => {
  it("crea un lead con solo nombre y teléfono: nuevo, sin agente y con puntuación", async () => {
    const { codigo, cuerpo } = await crearPorApi({ nombre: "Ana Torres", telefono: "600123456" });

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ nombre: "Ana Torres", telefono: "600123456", estado: "nuevo", agente: null, version: 1 });
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
      telefono: "+34600123456",
      clienteNuevo: true,
      interes: 5,
      origen: "recomendacion",
    });

    expect(codigo).toBe(201);
    expect(cuerpo.puntuacion).toBe(100);
    expect(cuerpo.prioridad).toBe("alta");
    expect(cuerpo.desglose.map((c: { valoracion: number }) => c.valoracion)).toEqual([100, 100, 100, 100]);
  });

  it("quita los espacios sobrantes del nombre y del teléfono", async () => {
    const { cuerpo } = await crearPorApi({ nombre: "  Ana  ", telefono: "+34 600 123 456" });

    expect(cuerpo.nombre).toBe("Ana");
    expect(cuerpo.telefono).toBe("+34600123456");
  });

  it("el lead creado se puede ver por su id y aparece en el listado", async () => {
    const { cuerpo: creado } = await crearPorApi({ nombre: "Ana", telefono: "600123456" });

    const visto = await verLead(creado.id);
    const listado = await pedir();

    expect(visto.cuerpo).toEqual(creado);
    expect(nombres(listado.cuerpo)).toEqual(["Ana"]);
  });

  it.each<[string, unknown]>([
    ["sin nombre", { telefono: "600123456" }],
    ["con el nombre vacío", { nombre: "   ", telefono: "600123456" }],
    ["sin teléfono", { nombre: "Ana" }],
    ["con un teléfono con letras", { nombre: "Ana", telefono: "abc123456" }],
    ["con un teléfono demasiado corto", { nombre: "Ana", telefono: "12345" }],
    ["con un teléfono demasiado largo", { nombre: "Ana", telefono: "1234567890123456" }],
    ["con interés 0", { nombre: "Ana", telefono: "600123456", interes: 0 }],
    ["con interés 6", { nombre: "Ana", telefono: "600123456", interes: 6 }],
    ["con interés con decimales", { nombre: "Ana", telefono: "600123456", interes: 2.5 }],
    ["con un origen que no existe", { nombre: "Ana", telefono: "600123456", origen: "tele" }],
    ["con clienteNuevo que no es booleano", { nombre: "Ana", telefono: "600123456", clienteNuevo: "si" }],
  ])("rechaza un lead %s", async (_descripcion, cuerpo) => {
    const res = await crearPorApi(cuerpo);

    expect(res.codigo).toBe(400);
    expect(res.cuerpo.error).toBe("datos no válidos");
    expect(await contarFilas()).toBe(0);
  });

  it.each(["estado", "puntuacion", "id"])("rechaza el campo %s porque no se puede fijar", async (campo) => {
    const res = await crearPorApi({ nombre: "Ana", telefono: "600123456", [campo]: "x" });

    expect(res.codigo).toBe(400);
    expect(res.cuerpo.detalles).toEqual([{ campo, mensaje: "campo no permitido" }]);
    expect(await contarFilas()).toBe(0);
  });

  it("el admin crea un lead asignado a un agente y nace en gestión", async () => {
    const ana = await crearAgente("Ana");

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", telefono: "600123456", agenteId: ana });

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana, nombre: "Ana" } });
  });

  it("un agente puede crear un lead asignado a sí mismo", async () => {
    const ana = await crearAgente("Ana");
    const comoAna = buildApp(async () => ({ id: ana, nombre: "Ana", rol: "agente" }));

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", telefono: "600123456", agenteId: ana }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ estado: "en_gestion", agente: { id: ana } });
  });

  it("un agente no puede crear un lead asignado a otro agente", async () => {
    const ana = await crearAgente("Ana");
    const luis = await crearAgente("Luis");
    const comoAna = buildApp(async () => ({ id: ana, nombre: "Ana", rol: "agente" }));

    const { codigo } = await crearPorApi({ nombre: "Lead", telefono: "600123456", agenteId: luis }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(403);
    expect(await contarFilas()).toBe(0);
  });

  it("un agente puede crear un lead sin agente", async () => {
    const ana = await crearAgente("Ana");
    const comoAna = buildApp(async () => ({ id: ana, nombre: "Ana", rol: "agente" }));

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", telefono: "600123456" }, comoAna);
    await comoAna.close();

    expect(codigo).toBe(201);
    expect(cuerpo).toMatchObject({ estado: "nuevo", agente: null });
  });

  it("rechaza un agente que no existe", async () => {
    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", telefono: "600123456", agenteId: 999 });

    expect(codigo).toBe(400);
    expect(cuerpo.detalles).toEqual([{ campo: "agenteId", mensaje: "el agente no existe" }]);
    expect(await contarFilas()).toBe(0);
  });

  it("rechaza asignar el lead a un administrador", async () => {
    const [{ id: admin }] = await sql<{ id: number }[]>`
      insert into agentes (nombre, rol, token) values ('Jefa', 'admin', 'token-jefa') returning id
    `;

    const { codigo, cuerpo } = await crearPorApi({ nombre: "Lead", telefono: "600123456", agenteId: admin });

    expect(codigo).toBe(400);
    expect(cuerpo.detalles[0].mensaje).toBe("no se pueden asignar leads a un administrador");
    expect(await contarFilas()).toBe(0);
  });

  it.each([0, -1, 1.5, "1"])("rechaza un agenteId no válido (%s)", async (agenteId) => {
    const { codigo } = await crearPorApi({ nombre: "Lead", telefono: "600123456", agenteId });

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

    const res = await sinPermiso.inject({ method: "POST", url: "/leads", payload: { nombre: "Ana", telefono: "600123456" } });
    await sinPermiso.close();

    expect(res.statusCode).toBe(401);
    expect(await contarFilas()).toBe(0);
  });

  it("no se deja engañar por un texto de inyección SQL en el nombre", async () => {
    const nombre = "Robert'); drop table leads;--";

    const { codigo, cuerpo } = await crearPorApi({ nombre, telefono: "600123456" });

    expect(codigo).toBe(201);
    expect(cuerpo.nombre).toBe(nombre);
    expect(await contarFilas()).toBe(1);
  });
});

// tests de GET /leads/:id
describe("ver un lead", () => {
  it("devuelve el lead con su agente, su puntuación y su desglose", async () => {
    const ana = await crearAgente("Ana");
    await crearLead({ nombre: "Lead", estado: "en_gestion", agenteId: ana, clienteNuevo: true, interes: 3, origen: "web" });
    const [{ id }] = await sql<{ id: number }[]>`select id from leads`;

    const { codigo, cuerpo } = await verLead(id);

    expect(codigo).toBe(200);
    expect(cuerpo).toMatchObject({ id, nombre: "Lead", estado: "en_gestion", agente: { id: ana, nombre: "Ana" }, version: 1 });
    // cliente nuevo 100*40/100 + interés 50*30/100 + origen web 70*20/100 + antigüedad 100*10/100
    expect(cuerpo.puntuacion).toBe(79);
    expect(cuerpo.prioridad).toBe("alta");
    expect(cuerpo.desglose).toEqual([
      { criterio: "Cliente nuevo", valoracion: 100, peso: 40, aporte: 40 },
      { criterio: "Interés comercial", valoracion: 50, peso: 30, aporte: 15 },
      { criterio: "Origen del lead", valoracion: 70, peso: 20, aporte: 14 },
      { criterio: "Antigüedad", valoracion: 100, peso: 10, aporte: 10 },
    ]);
  });

  it("devuelve null en agente si el lead no tiene agente", async () => {
    await crearLead({ nombre: "Lead" });
    const [{ id }] = await sql<{ id: number }[]>`select id from leads`;

    const { cuerpo } = await verLead(id);

    expect(cuerpo.agente).toBeNull();
  });

  it("devuelve 404 si el lead no existe", async () => {
    const { codigo, cuerpo } = await verLead(999);

    expect(codigo).toBe(404);
    expect(cuerpo.error).toBe("lead no encontrado");
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999"])("devuelve 400 si el id es %s", async (id) => {
    const { codigo, cuerpo } = await verLead(id);

    expect(codigo).toBe(400);
    expect(cuerpo.error).toBe("id no válido");
  });
});

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
    await crearLead({ nombre: "Reino Unido", prefijo: "44", telefono: "7911123456" });

    const porNombre = await pedir("?q=ANA");
    const porTilde = await pedir(`?q=${encodeURIComponent("pérez")}`);
    const porTelefono = await pedir("?q=6222");

    expect(nombres(porNombre.cuerpo)).toEqual(["Ana Torres"]);
    expect(nombres(porTilde.cuerpo)).toEqual(["Luis Pérez"]);
    expect(nombres(porTelefono.cuerpo)).toEqual(["Luis Pérez"]);

    // el teléfono se busca con su prefijo, con o sin +
    const conMas = await pedir(`?q=${encodeURIComponent("+447911")}`);
    const sinMas = await pedir("?q=447911");
    expect(nombres(conMas.cuerpo)).toEqual(["Reino Unido"]);
    expect(nombres(sinMas.cuerpo)).toEqual(["Reino Unido"]);
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

// tests de GET /leads/:id
describe("ver un lead", () => {
  it("devuelve los datos tal como se guardaron, con interés y origen nulos si no se indicaron", async () => {
    await crearLead({ nombre: "Con datos", clienteNuevo: true, interes: 4, origen: "anuncio" });
    await crearLead({ nombre: "Sin datos" });
    const filas = await sql<{ id: number; nombre: string }[]>`select id, nombre from leads order by id`;

    const con = await verLead(filas[0].id);
    const sin = await verLead(filas[1].id);

    expect(con.cuerpo).toMatchObject({ clienteNuevo: true, interes: 4, origen: "anuncio" });
    expect(sin.cuerpo).toMatchObject({ clienteNuevo: false, interes: null, origen: null });
  });

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

// hace una petición PUT /leads/:id como un usuario autenticado (por defecto, como el admin de prueba)
async function editarPorApi(id: number | string, cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "PUT",
    url: `/leads/${id}`,
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

// crea un lead en la base de datos y devuelve su id
async function crearLeadConId(datos: DatosLead) {
  await crearLead(datos);
  const [{ id }] = await sql<{ id: number }[]>`select max(id)::int as id from leads`;
  return id;
}

// lee de la base de datos los datos y la versión de un lead
async function leerFila(id: number) {
  const [fila] = await sql`
    select nombre, telefono, cliente_nuevo, interes, origen, estado, agente_id, version from leads where id = ${id}
  `;
  return fila;
}

// datos válidos para editar un lead (con la versión que vio el cliente)
const edicion = (version: number, resto = {}) => ({ nombre: "Nuevo nombre", prefijo: "34", telefono: "699888777", version, ...resto });

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

// crea un servidor que atiende como el usuario indicado
const servidorComo = (id: number, rol: "agente" | "admin") => buildApp(async () => ({ id, nombre: "Usuario", rol }));

// hace una petición POST a /leads/:id/asignar o /leads/:id/liberar
async function accionPorApi(accion: "asignar" | "liberar", id: number | string, cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "POST",
    url: `/leads/${id}/${accion}`,
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}
const asignarPorApi = (id: number | string, cuerpo: unknown, servidor = app) => accionPorApi("asignar", id, cuerpo, servidor);
const liberarPorApi = (id: number | string, cuerpo: unknown, servidor = app) => accionPorApi("liberar", id, cuerpo, servidor);

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

// hace una petición PUT /leads/:id/estado como un usuario autenticado (por defecto, como el admin de prueba)
async function estadoPorApi(id: number | string, cuerpo: unknown, servidor = app) {
  const res = await servidor.inject({
    method: "PUT",
    url: `/leads/${id}/estado`,
    headers: { authorization: "Bearer prueba" },
    payload: cuerpo as object,
  });
  return { codigo: res.statusCode, cuerpo: res.json() };
}

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

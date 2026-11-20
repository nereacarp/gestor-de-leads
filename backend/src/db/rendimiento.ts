// mide cuánto tardan las consultas en una base de datos aparte (npm run db:rendimiento; con la variable TOTAL_LEADS se cambia la cantidad de leads)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// nombre de la base de datos donde se hace la prueba, aparte de la de desarrollo
const NOMBRE_BASE = "leads_rendimiento";
// cantidad de leads: la variable TOTAL_LEADS, el primer argumento o 50.000 si no se pasa ninguno
const TOTAL_LEADS = Number(process.env.TOTAL_LEADS ?? process.argv[2] ?? 50_000);
const REPETICIONES = 10;

// ejecuta toda la prueba en una función
async function main() {
  const urlDesarrollo = process.env.DATABASE_URL; // lee la url de la base de datos del .env
  if (!urlDesarrollo) throw new Error("falta DATABASE_URL en el .env");

  // crea la base de datos de la prueba si no existe
  const admin = postgres(urlDesarrollo);
  try {
    const existe = await admin`select 1 from pg_database where datname = ${NOMBRE_BASE}`;
    if (existe.length === 0) await admin.unsafe(`create database ${NOMBRE_BASE}`);
  } finally {
    await admin.end();
  }

  // apunta el resto del backend a la base de datos de la prueba; se importa después porque sql.ts lee la url al cargarse
  const urlRendimiento = new URL(urlDesarrollo);
  urlRendimiento.pathname = `/${NOMBRE_BASE}`;
  process.env.DATABASE_URL = urlRendimiento.toString();
  const { sql } = await import("./sql.js");
  const { listarLeads, obtenerLead } = await import("../leads/consultas.js");
  const { guardarPesos } = await import("../pesos/consultas.js");

  // aplica el esquema sin avisos
  const esquema = join(__dirname, "../../db/schema.sql");
  const conexion = await sql.reserve();
  try {
    await conexion`set client_min_messages = warning`;
    await conexion.unsafe(readFileSync(esquema, "utf-8"));
  } finally {
    conexion.release();
  }

  // vacía las tablas y los pesos vuelven a los iniciales
  await sql`truncate leads, agentes restart identity cascade`;
  await sql`update pesos set peso_cliente_nuevo = 40, peso_interes = 30, peso_origen = 20, peso_antiguedad = 10`;

  // crea un admin y nueve agentes
  await sql`
    insert into agentes (nombre, rol, token)
    select 'Agente ' || n, case when n = 1 then 'admin' else 'agente' end, 'token-' || n
    from generate_series(1, 10) n
  `;

  // crea los leads repartidos entre los cuatro estados; los de gestión y contactados llevan agente (del 2 al 10)
  console.log(`creando ${TOTAL_LEADS} leads...`);
  await sql`
    insert into leads (nombre, prefijo, telefono, estado, agente_id, cliente_nuevo, interes, origen, created_at, updated_at)
    select
      'Lead ' || n,
      '34',
      (600000000 + n)::text,
      e.estado,
      case when e.estado in ('en_gestion', 'contactado') or (e.estado = 'cerrado' and n % 2 = 0)
        then 2 + n % 9 else null end,
      n % 2 = 0,
      1 + n % 5,
      (array['recomendacion', 'web', 'anuncio', 'llamada'])[1 + n % 4],
      now() - (n % 365) * interval '1 day',
      now()
    from generate_series(1, ${TOTAL_LEADS}::int) n
    cross join lateral (
      select (array['nuevo', 'en_gestion', 'contactado', 'cerrado'])[1 + n % 4] as estado
    ) e
  `;
  await sql`analyze leads`;

  // mide una función varias veces y devuelve la mediana y el máximo en milisegundos
  async function medir(accion: () => Promise<unknown>) {
    await accion(); // la primera vez no cuenta (calienta la caché)
    const tiempos: number[] = [];
    for (let i = 0; i < REPETICIONES; i++) {
      const inicio = performance.now();
      await accion();
      tiempos.push(performance.now() - inicio);
    }
    tiempos.sort((a, b) => a - b);
    return { mediana: tiempos[Math.floor(tiempos.length / 2)], maximo: tiempos[tiempos.length - 1] };
  }

  // filtros de un listado normal: primera página de 20 leads
  const base = { pagina: 1, limite: 20 };
  // última página con 20 leads por página
  const ultimaPagina = Math.ceil(TOTAL_LEADS / 20);

  // consultas de lectura que se miden una por una
  const casos: { nombre: string; accion: () => Promise<unknown> }[] = [
    { nombre: "listado sin filtros, página 1", accion: () => listarLeads(base) },
    { nombre: "listado sin filtros, última página", accion: () => listarLeads({ ...base, pagina: ultimaPagina }) },
    { nombre: "listado con 100 por página", accion: () => listarLeads({ ...base, limite: 100 }) },
    { nombre: "filtro por estado (nuevo)", accion: () => listarLeads({ ...base, estado: "nuevo" }) },
    { nombre: "filtro por agente (2)", accion: () => listarLeads({ ...base, agente: 2 }) },
    { nombre: "filtro por agente (sin)", accion: () => listarLeads({ ...base, agente: "sin" }) },
    { nombre: "búsqueda por nombre (Lead 49)", accion: () => listarLeads({ ...base, q: "Lead 49" }) },
    { nombre: "búsqueda por teléfono (0012)", accion: () => listarLeads({ ...base, q: "0012" }) },
    { nombre: "búsqueda sin resultados (zzz)", accion: () => listarLeads({ ...base, q: "zzz" }) },
    {
      nombre: "estado + agente + búsqueda",
      accion: () => listarLeads({ ...base, estado: "en_gestion", agente: 2, q: "Lead 1" }),
    },
    { nombre: "detalle de un lead", accion: () => obtenerLead(Math.floor(TOTAL_LEADS / 2)) },
  ];

  console.log(`\nmedianas y máximos de ${REPETICIONES} repeticiones con ${TOTAL_LEADS} leads:\n`);
  for (const caso of casos) {
    const { mediana, maximo } = await medir(caso.accion);
    console.log(`${caso.nombre.padEnd(40)} mediana ${mediana.toFixed(1).padStart(7)} ms   máximo ${maximo.toFixed(1).padStart(7)} ms`);
  }

  // dos juegos de pesos distintos, para cambiar de uno a otro en cada repetición
  const juegoA = [
    { criterio: "cliente_nuevo", peso: 40 },
    { criterio: "interes", peso: 30 },
    { criterio: "origen", peso: 20 },
    { criterio: "antiguedad", peso: 10 },
  ] as const;
  const juegoB = [
    { criterio: "cliente_nuevo", peso: 10 },
    { criterio: "interes", peso: 20 },
    { criterio: "origen", peso: 30 },
    { criterio: "antiguedad", peso: 40 },
  ] as const;
  // cambia de un juego de pesos al otro en cada llamada
  let usaA = false;
  const cambiarPesos = () => guardarPesos([...((usaA = !usaA) ? juegoA : juegoB)]);

  // cambios de pesos y consultas simultáneas que se miden
  const cambios = [
    { nombre: "cambiar los pesos", accion: () => cambiarPesos() },
    {
      nombre: "cambiar los pesos + pedir el listado",
      accion: async () => {
        await cambiarPesos();
        await listarLeads(base);
      },
    },
    {
      // lo que habría que hacer si la nota se guardara en una columna
      nombre: "alternativa: recalcular y guardar todas las notas",
      accion: () => sql`update leads l set nota_guardada = lp.puntuacion from leads_puntuados lp where lp.id = l.id`,
    },
    {
      nombre: "10 listados a la vez (tiempo total)",
      accion: () => Promise.all(Array.from({ length: 10 }, () => listarLeads(base))),
    },
    {
      nombre: "10 listados y 10 cambios de pesos a la vez (total)",
      accion: () =>
        Promise.all([
          ...Array.from({ length: 10 }, () => listarLeads(base)),
          ...Array.from({ length: 10 }, () => cambiarPesos()),
        ]),
    },
  ];

  console.log("\ncambio de pesos y consultas a la vez:\n");
  // columna temporal para simular guardar la nota; se borra al terminar
  await sql`alter table leads add column if not exists nota_guardada double precision`;
  for (const caso of cambios) {
    const { mediana, maximo } = await medir(caso.accion);
    console.log(`${caso.nombre.padEnd(52)} mediana ${mediana.toFixed(1).padStart(7)} ms   máximo ${maximo.toFixed(1).padStart(7)} ms`);
  }
  await sql`alter table leads drop column nota_guardada`;

  await sql.end();
}

// muestra el error y termina con código 1 si algo falla
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

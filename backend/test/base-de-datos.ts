import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sql } from "../src/db/sql";

// nombre de la base de datos de tests
const NOMBRE_BASE = "leads_test";
// conecta a la base de datos de desarrollo para crear la de tests
const URL_DESARROLLO = "postgresql://leads:leads@localhost:5432/leads";

// crea la base de datos de tests y le aplica el esquema
export async function prepararBaseDeDatos() {
  // abre una conexión a la base de datos de desarrollo
  const admin = postgres(URL_DESARROLLO);
  try {
    // comprueba si la base de datos de tests ya existe
    const existe = await admin`select 1 from pg_database where datname = ${NOMBRE_BASE}`;
    if (existe.length === 0) {
      await admin.unsafe(`create database ${NOMBRE_BASE}`);
    }
  } catch (error) {
    throw new Error("no se puede conectar a la base de datos: ¿está Docker arrancado? (docker compose up -d)", {
      cause: error,
    });
  } finally {
    await admin.end();
  }

  // aplica schema.sql a la base de datos de tests
  const esquema = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
  await sql.file(esquema).simple();
}

// borra los leads y los agentes y deja los pesos iniciales
export async function vaciarTablas() {
  // se niega a vaciar una base de datos que no sea de tests
  const [{ nombre }] = await sql`select current_database() as nombre`;
  if (!String(nombre).endsWith("_test")) {
    throw new Error(`no se vacía la base de datos ${nombre} porque no es de tests`);
  }

  // vacía las tablas y reinicia los ids
  await sql`truncate leads, agentes restart identity cascade`;
  // restablece los pesos iniciales
  await sql`
    update pesos
    set peso_cliente_nuevo = 40, peso_interes = 30, peso_origen = 20, peso_antiguedad = 10
  `;
}

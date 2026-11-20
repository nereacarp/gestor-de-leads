import { sql } from "./sql";

// borra todas las tablas (y la vista que depende de ellas) para empezar de cero
async function reset() {
  await sql`drop table if exists leads, agentes, pesos cascade`; // cascade borra también la vista leads_puntuados
  console.log("tablas borradas");
  await sql.end();
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});

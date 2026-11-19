import { sql } from "./sql";

// borra todas las tablas para empezar de cero
async function reset() {
  await sql`drop table if exists leads, agentes, pesos`;
  console.log("tablas borradas");
  await sql.end();
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});

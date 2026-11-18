import { join } from "node:path";
import { sql } from "./sql";

// ejecuta schema.sql para crear las tablas
async function setup() {
  const ruta = join(__dirname, "../../db/schema.sql"); // ruta del archivo desde este script
  await sql.file(ruta).simple(); // ejecuta todas las órdenes del archivo
  console.log("tablas creadas");
  await sql.end(); // cierra la conexión para que el script termine
}

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});

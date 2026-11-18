import postgres from "postgres";

const url = process.env.DATABASE_URL; // lee la url de la base de datos del .env
if (!url) throw new Error("falta DATABASE_URL en el .env");

// crea la conexión que usará el resto del backend
export const sql = postgres(url);

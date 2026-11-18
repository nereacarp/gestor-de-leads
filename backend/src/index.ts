import { buildApp } from "./app";

const app = buildApp(); // crea una instancia del servidor de Fastify
const port = Number(process.env.PORT ?? 3000); // obtiene el puerto del entorno

async function start() {
  try {
    await app.listen({ port }); // escucha peticiones en el puerto
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

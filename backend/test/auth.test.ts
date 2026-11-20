import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { soloAdmin, type Agente } from "../src/auth";

// define los agentes de prueba, sin usar la base de datos
const agentes: Record<string, Agente> = {
  "token-agente": { id: 1, nombre: "Agente 01", rol: "agente" },
  "token-admin": { id: 2, nombre: "Admin", rol: "admin" },
};

// crea un servidor con autenticación simulada
function crearApp() {
  const app = buildApp(async (token) => agentes[token] ?? null);
  // añade una ruta solo para admin para probar la comprobación de rol
  app.get("/solo-admin", { preHandler: soloAdmin }, async () => ({ ok: true }));
  return app;
}

// tests del token, el agente de cada petición y el rol de admin
describe("autenticación simulada", () => {
  it("deja usar /health sin token", async () => {
    const res = await crearApp().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("responde 401 si falta el token", async () => {
    const res = await crearApp().inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });

  it("responde 401 si el token no existe", async () => {
    const res = await crearApp().inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer token-falso" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("responde 401 si la cabecera no es Bearer", async () => {
    const res = await crearApp().inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "token-agente" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("devuelve el agente de un token válido", async () => {
    const res = await crearApp().inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer token-agente" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(agentes["token-agente"]);
  });

  it("responde 403 si un agente usa una ruta de admin", async () => {
    const res = await crearApp().inject({
      method: "GET",
      url: "/solo-admin",
      headers: { authorization: "Bearer token-agente" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("deja a un admin usar una ruta de admin", async () => {
    const res = await crearApp().inject({
      method: "GET",
      url: "/solo-admin",
      headers: { authorization: "Bearer token-admin" },
    });
    expect(res.statusCode).toBe(200);
  });
});

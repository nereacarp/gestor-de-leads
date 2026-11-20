import { describe, expect, it } from "vitest";
import { sql } from "../../src/db/sql";
import { type Lead, crearAgente, crearLead, verLead, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

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

import { describe, expect, it } from "vitest";
import { type Lead, crearAgente, crearLead, prepararTests } from "./funciones-compartidas";

// prepara la base de datos y el servidor de los tests de este archivo
prepararTests();

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

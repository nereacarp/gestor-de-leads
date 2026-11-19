import { z } from "zod";

// roles que puede tener un agente
export const ROLES = ["agente", "admin"] as const;

// parámetros que acepta GET /agentes en la URL
export const filtrosSchema = z.object({
  // devuelve solo los agentes de este rol (sin indicarlo devuelve todos)
  rol: z.enum(ROLES).optional(),
});

export type Filtros = z.infer<typeof filtrosSchema>;

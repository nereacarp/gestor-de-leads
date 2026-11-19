import { z } from "zod";

// estados que puede tener un lead
export const ESTADOS = ["nuevo", "en_gestion", "contactado", "cerrado"] as const;

// esquema de parámetros que acepta GET /leads en la URL
export const filtrosSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  // id de un agente o "sin" para los leads sin agente asignado
  agente: z.union([z.literal("sin"), z.coerce.number().int().positive()]).optional(),
  
  // texto a buscar en el nombre o el teléfono
  q: z
    .string()
    .trim()
    .max(100)
    .transform((texto) => texto || undefined)
    .optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

export type Filtros = z.infer<typeof filtrosSchema>;

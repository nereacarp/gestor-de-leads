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

// orígenes que puede tener un lead
export const ORIGENES = ["recomendacion", "web", "anuncio", "llamada"] as const;

// esquema del cuerpo que acepta POST /leads
export const nuevoLeadSchema = z.strictObject({
  nombre: z.string().trim().min(1, "el nombre es obligatorio").max(100),
  // quita los espacios y acepta un + opcional seguido de 7 a 15 dígitos
  telefono: z
    .string()
    .transform((texto) => texto.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\+?\d{7,15}$/, "el teléfono debe tener de 7 a 15 dígitos, con + opcional al principio")),
  clienteNuevo: z.boolean().default(false),
  interes: z.number().int().min(1).max(5).optional(),
  origen: z.enum(ORIGENES).optional(),
  // si viene, el lead se crea asignado a ese agente y en gestión
  agenteId: z.number().int().positive().optional(),
});

export type NuevoLead = z.infer<typeof nuevoLeadSchema>;

// esquema de los parámetros de la dirección de GET /leads/:id
export const idSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647),
});

// esquema del cuerpo que acepta PUT /leads/:id (los datos del lead como al crear y la versión que vio el cliente)
export const editarLeadSchema = nuevoLeadSchema.omit({ agenteId: true }).extend({
  version: z.number().int().positive(),
});

export type EditarLead = z.infer<typeof editarLeadSchema>;

// esquema del cuerpo que acepta POST /leads/:id/asignar (el agente y la versión que vio el cliente)
export const asignarSchema = z.strictObject({
  agenteId: z.number().int().positive(),
  version: z.number().int().positive(),
});

// esquema del cuerpo que acepta POST /leads/:id/liberar (la versión que vio el cliente)
export const liberarSchema = z.strictObject({
  version: z.number().int().positive(),
});


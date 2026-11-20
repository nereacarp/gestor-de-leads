import { z } from "zod";

// criterios que puede tener el sistema de pesos
export const CRITERIOS = ["cliente_nuevo", "interes", "origen", "antiguedad"] as const;
export type Criterio = (typeof CRITERIOS)[number];

// esquema del cuerpo que acepta PUT /pesos (los 4 criterios una sola vez y con suma 100)
export const pesosSchema = z
  .array(
    z.object({
      criterio: z.enum(CRITERIOS),
      peso: z.number().int().min(0).max(100),
    }),
  )
  .superRefine((lista, ctx) => {
    // comprueba que no haya criterios repetidos
    const vistos = new Set<string>();
    for (const { criterio } of lista) {
      if (vistos.has(criterio)) {
        ctx.addIssue({ code: "custom", message: `el criterio ${criterio} está repetido` });
      }
      vistos.add(criterio);
    }

    // comprueba que no falte ningún criterio
    for (const criterio of CRITERIOS) {
      if (!vistos.has(criterio)) {
        ctx.addIssue({ code: "custom", message: `falta el criterio ${criterio}` });
      }
    }

    // comprueba que la suma sea 100
    const suma = lista.reduce((total, c) => total + c.peso, 0);
    if (suma !== 100) {
      ctx.addIssue({ code: "custom", message: `los pesos deben sumar 100 (suman ${suma})` });
    }
  });

export type Pesos = z.infer<typeof pesosSchema>;

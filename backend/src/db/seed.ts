import { fakerES as faker } from "@faker-js/faker";
import { sql } from "./sql";

const TOTAL_LEADS = 500; // cantidad de leads de ejemplo

// calcula fechas del pasado al azar
function fechaHaceDias(dias: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  fecha.setHours(fecha.getHours() - faker.number.int({ min: 0, max: 23 }));
  return fecha;
}

// inserta los agentes y los leads de ejemplo si todavía no hay datos
async function seed() {
  const [{ total }] = await sql<{ total: number }[]>`
    select ((select count(*) from agentes) + (select count(*) from leads))::int as total
  `; // cuenta las filas de agentes y de leads
  if (total > 0) {
    console.log("ya hay agentes o leads, no se hace nada (para reiniciarlos, usa db:reset)");
    await sql.end();
    return;
  }

  faker.seed(123);

  // crea un admin y tres agentes
  const agentes = [
    { nombre: faker.person.fullName(), rol: "admin", token: "admin-01" },
    ...Array.from({ length: 3 }, (_, i) => ({
      nombre: faker.person.fullName(),
      rol: "agente",
      token: `agente-0${i + 1}`,
    })),
  ];

  // genera un lead al azar
  const generarLead = (idsAgentes: number[]) => {
    const estado = faker.helpers.weightedArrayElement([
      { weight: 40, value: "nuevo" },
      { weight: 25, value: "en_gestion" },
      { weight: 20, value: "contactado" },
      { weight: 15, value: "cerrado" },
    ]);
    const dias = faker.number.int({ min: 0, max: 180 }); // 6 meses de antigüedad max
    const fecha = fechaHaceDias(dias);

    return {
      nombre: faker.person.fullName(),
      prefijo: "34",
      telefono: faker.helpers.arrayElement(["6", "7"]) + faker.string.numeric(8),
      estado,
      agente_id: estado === "nuevo" ? null : faker.helpers.arrayElement(idsAgentes), // los nuevos no tienen agente
      cliente_nuevo: faker.datatype.boolean({ probability: 0.7 }),
      interes: faker.datatype.boolean({ probability: 0.1 }) ? null : faker.number.int({ min: 1, max: 5 }),
      origen: faker.datatype.boolean({ probability: 0.1 })
        ? null
        : faker.helpers.weightedArrayElement([
            { weight: 40, value: "web" },
            { weight: 30, value: "anuncio" },
            { weight: 15, value: "recomendacion" },
            { weight: 15, value: "llamada" },
          ]),
      created_at: fecha,
      updated_at: fecha, 
    };
  };

  // guarda todo en una transacción
  await sql.begin(async (tx) => {
    const creados = await tx`insert into agentes ${tx(agentes)} returning id, rol`;
    const idsAgentes = creados.filter((a) => a.rol === "agente").map((a) => a.id as number);

    const leads = Array.from({ length: TOTAL_LEADS }, () => generarLead(idsAgentes));
    await tx`insert into leads ${tx(leads)}`;
  });

  console.log(`datos creados: 1 admin, 3 agentes y ${TOTAL_LEADS} leads`);
  await sql.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

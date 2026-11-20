import { useParams } from "react-router";

// muestra la pantalla del detalle de un lead (pendiente)
export function Detalle() {
  // lee el id del lead de la dirección (/leads/:id)
  const { id } = useParams();

  return (
    <main>
      <h1>Lead {id}</h1>
      <p>pendiente: datos del lead, desglose de la puntuación, editar, asignar y cambiar el estado</p>
    </main>
  );
}

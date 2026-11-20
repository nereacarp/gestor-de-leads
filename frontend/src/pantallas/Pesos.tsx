import { useState } from "react";
import { ErrorApi, pedirApi } from "../api/clienteApi";
import { useApi } from "../api/hookApi";
import { useSesion } from "../api/sesion";

// describe el peso de un criterio, como lo envía y lo devuelve la api
type Peso = { criterio: string; peso: number };

// nombres con los que se muestra cada criterio
const NOMBRES: Record<string, string> = {
  cliente_nuevo: "Cliente nuevo",
  interes: "Interés comercial",
  origen: "Origen del lead",
  antiguedad: "Antigüedad",
};

// muestra los campos para editar los pesos y los guarda solo si suman 100
function FormularioPesos({ inicial }: { inicial: Peso[] }) {
  const { token } = useSesion();
  const [valores, setValores] = useState(inicial.map((p) => String(p.peso))); // texto de cada campo, en el orden de los criterios
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<ErrorApi | null>(null);

  // suma de los 4 pesos (un campo vacío cuenta como 0)
  const total = valores.reduce((suma, valor) => suma + Number(valor), 0);

  // guarda el texto de un campo dejando solo dígitos
  function cambiar(indice: number, texto: string) {
    setValores(valores.map((valor, i) => (i === indice ? texto.replace(/\D/g, "") : valor)));
    setGuardado(false);
  }

  // envía los pesos a la api y muestra los que ha guardado
  async function guardar() {
    setGuardando(true);
    setGuardado(false);
    setError(null);

    try {
      const lista = inicial.map((p, i) => ({ criterio: p.criterio, peso: Number(valores[i]) }));
      const respuesta = await pedirApi<{ datos: Peso[] }>(token, "/pesos", { metodo: "PUT", cuerpo: lista });
      setValores(respuesta.datos.map((p) => String(p.peso)));
      setGuardado(true);
    } catch (e) {
      setError(e as ErrorApi);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <table>
        <thead>
          <tr>
            <th>Criterio</th>
            <th>Peso (%)</th>
            <th>Valoración</th>
          </tr>
        </thead>
        <tbody>
          {inicial.map((p, i) => (
            <tr key={p.criterio}>
              <td>
                <label htmlFor={p.criterio}>{NOMBRES[p.criterio] ?? p.criterio}</label>
              </td>
              <td>
                <input
                  id={p.criterio}
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={valores[i]}
                  onChange={(e) => cambiar(i, e.target.value)}
                />
              </td>
              <td>0–100</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        Total: {total} %{total !== 100 && " (los pesos deben sumar 100)"}
      </p>
      <button type="submit" disabled={total !== 100 || guardando}>
        {guardando ? "guardando..." : "Guardar pesos"}
      </button>

      {guardado && <p>Pesos guardados</p>}
      {error && (
        <div>
          <p>error: {error.message}</p>
          <ul>
            {error.detalles.map((detalle, i) => (
              <li key={i}>
                {detalle.campo && `${detalle.campo}: `}
                {detalle.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

// pantalla de administración de los pesos de la puntuación
export function Pesos() {
  const { datos: respuesta, cargando, error, recargar } = useApi<{ datos: Peso[] }>("/pesos");

  return (
    <main>
      <h1>Configuración de pesos / Administración</h1>
      {cargando && <p>cargando...</p>}
      {error && (
        <p>
          error: {error.message} <button onClick={recargar}>Reintentar</button>
        </p>
      )}
      {/* se muestra solo con datos recién cargados, para no enseñar los de otro usuario */}
      {!cargando && !error && respuesta && <FormularioPesos inicial={respuesta.datos} />}
    </main>
  );
}

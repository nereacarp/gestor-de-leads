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

// texto que explica cómo se valora (de 0 a 100) cada criterio
const VALORACIONES: Record<string, string> = {
  cliente_nuevo: "Sí 100, no 0",
  interes: "De 1 a 5 se convierte en 0 a 100",
  origen: "Recomendación 100, web 70, anuncio 40, llamada 20",
  antiguedad: "100 el día que se crea, baja hasta 0 a los 90 días",
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
      className="pesos"
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      {/* aviso de que los pesos se han guardado */}
      {guardado && (
        <p className="aviso" role="status">
          Pesos guardados
        </p>
      )}
      {/* error de la api con sus detalles */}
      {error && (
        <div className="error" role="alert">
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

      {/* un campo de peso por criterio y cómo se valora cada uno */}
      <div className="tabla-caja compacta">
        <table>
          <thead>
            <tr>
              <th>Criterio</th>
              <th>Peso (%)</th>
              <th>Cómo se valora</th>
            </tr>
          </thead>
          <tbody>
            {inicial.map((p, i) => (
              <tr key={p.criterio}>
                <td>
                  <label htmlFor={p.criterio}>{NOMBRES[p.criterio] ?? p.criterio}</label>
                </td>
                <td>
                  <div className="campo-numero">
                    <input
                      id={p.criterio}
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={valores[i]}
                      onChange={(e) => cambiar(i, e.target.value)}
                    />
                    <span>%</span>
                  </div>
                </td>
                <td>{VALORACIONES[p.criterio] ?? "De 0 a 100"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* total de los pesos y botón de guardar */}
      <div className="pesos-pie">
        <div>
          <span>Total de los pesos{total !== 100 && " (deben sumar 100)"}</span>
          <strong className={total === 100 ? "" : "total-invalido"}>{total} %</strong>
        </div>
        <button className="boton principal" type="submit" disabled={total !== 100 || guardando}>
          {guardando ? "guardando..." : "Guardar pesos"}
        </button>
      </div>
    </form>
  );
}

// pantalla de administración de los pesos de la puntuación
export function Pesos() {
  const { datos: respuesta, cargando, error, recargar } = useApi<{ datos: Peso[] }>("/pesos");

  return (
    <main className="pagina">
      {/* título de la pantalla */}
      <div className="encabezado">
        <div>
          <p className="sobretitulo">Administración</p>
          <h1>Configuración de pesos</h1>
        </div>
      </div>
      {cargando && <p className="cargando">cargando...</p>}
      {error && (
        <p className="error">
          error: {error.message}{" "}
          <button className="boton secundario" onClick={recargar}>
            Reintentar
          </button>
        </p>
      )}
      {/* se muestra solo con datos recién cargados, para no enseñar los de otro usuario */}
      {!cargando && !error && respuesta && <FormularioPesos inicial={respuesta.datos} />}
    </main>
  );
}

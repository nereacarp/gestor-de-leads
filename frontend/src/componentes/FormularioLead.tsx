import { useState, type SubmitEvent } from "react";
import { ErrorApi, pedirApi } from "../api/clienteApi";
import { useApi } from "../api/hookApi";
import { useSesion } from "../api/sesion";

// describe un agente tal como lo devuelve la api
type Agente = { id: number; nombre: string };

// describe al usuario que ha iniciado sesión
type Usuario = { id: number; rol: "agente" | "admin" };

// orígenes que se pueden elegir
const ORIGENES: Record<string, string> = {
  recomendacion: "Recomendación",
  web: "Web",
  anuncio: "Anuncio",
  llamada: "Llamada",
};

// describe los campos del formulario (todos son texto, menos la casilla)
type Campos = {
  nombre: string;
  prefijo: string;
  numero: string;
  clienteNuevo: boolean;
  interes: string;
  origen: string;
  agenteId: string;
};

// valores con los que empieza el formulario (prefijo de España)
const INICIAL: Campos = { nombre: "", prefijo: "34", numero: "", clienteNuevo: false, interes: "", origen: "", agenteId: "" };

// devuelve el mensaje de error de cada campo obligatorio que no es válido
function validar(campos: Campos) {
  const errores: { nombre?: string; prefijo?: string; numero?: string } = {};
  if (campos.nombre.trim() === "") errores.nombre = "el nombre es obligatorio";
  if (campos.prefijo === "") errores.prefijo = "el prefijo es obligatorio";

  // el backend acepta de 7 a 15 dígitos contando el prefijo
  const digitos = campos.prefijo.length + campos.numero.length;
  if (digitos < 7 || digitos > 15) errores.numero = "el teléfono debe tener de 7 a 15 dígitos contando el prefijo";
  return errores;
}

// formulario para crear un lead; si se elige agente, pide confirmación antes de guardar
export function FormularioLead({ onGuardado, onCancelar }: { onGuardado: () => void; onCancelar: () => void }) {
  const { token } = useSesion();
  const { datos: yo } = useApi<Usuario>("/me");
  const { datos: agentes } = useApi<{ datos: Agente[] }>("/agentes?rol=agente");

  const [campos, setCampos] = useState(INICIAL);
  const [tocados, setTocados] = useState<Record<string, boolean>>({}); // campos que el usuario ya ha dejado
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<ErrorApi | null>(null);

  const errores = validar(campos);
  const hayErrores = Object.keys(errores).length > 0;

  // el admin puede asignar a cualquier agente y un agente solo a sí mismo
  const asignables = (agentes?.datos ?? []).filter((a) => yo?.rol === "admin" || a.id === yo?.id);
  const agenteElegido = asignables.find((a) => String(a.id) === campos.agenteId);

  // guarda el valor de un campo
  function cambiar<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setCampos({ ...campos, [campo]: valor });
  }

  // guarda un campo numérico dejando solo dígitos
  function cambiarDigitos(campo: "prefijo" | "numero", texto: string) {
    cambiar(campo, texto.replace(/\D/g, ""));
  }

  // marca un campo como tocado cuando el usuario sale de él
  function tocar(campo: string) {
    setTocados({ ...tocados, [campo]: true });
  }

  // muestra el error de un campo solo si el usuario ya ha salido de él
  function mensaje(campo: "nombre" | "prefijo" | "numero") {
    return tocados[campo] && errores[campo] ? <span> {errores[campo]}</span> : null;
  }

  // envía el lead a la api; si va bien, avisa a la pantalla para que cierre y recargue
  async function guardar() {
    setGuardando(true);
    setError(null);

    try {
      const cuerpo = {
        nombre: campos.nombre.trim(),
        telefono: `+${campos.prefijo}${campos.numero}`,
        clienteNuevo: campos.clienteNuevo,
        ...(campos.interes ? { interes: Number(campos.interes) } : {}),
        ...(campos.origen ? { origen: campos.origen } : {}),
        ...(campos.agenteId ? { agenteId: Number(campos.agenteId) } : {}),
      };
      await pedirApi(token, "/leads", { metodo: "POST", cuerpo });
      onGuardado();
    } catch (e) {
      setError(e as ErrorApi);
    } finally {
      setGuardando(false);
    }
  }

  // al guardar, pide confirmación si hay agente elegido; si no, guarda directamente
  function enviar(e: SubmitEvent) {
    e.preventDefault();
    if (campos.agenteId) setConfirmando(true);
    else guardar();
  }

  // muestra el mensaje de error de la api y sus detalles
  const errorApi = error && (
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
  );

  // pantalla de confirmación de la asignación
  if (confirmando) {
    return (
      <div>
        <p>
          El lead «{campos.nombre.trim()}» se creará asignado a {agenteElegido?.nombre} y en estado "En gestión". ¿Confirmas?
        </p>
        <button onClick={guardar} disabled={guardando}>
          {guardando ? "guardando..." : "Confirmar y crear"}
        </button>{" "}
        <button
          disabled={guardando}
          onClick={() => {
            setConfirmando(false);
            setError(null);
          }}
        >
          Volver
        </button>
        {errorApi}
      </div>
    );
  }

  return (
    <form onSubmit={enviar}>
      <div>
        <label htmlFor="nombre">Nombre *</label>{" "}
        <input
          id="nombre"
          maxLength={100}
          value={campos.nombre}
          onChange={(e) => cambiar("nombre", e.target.value)}
          onBlur={() => tocar("nombre")}
        />
        {mensaje("nombre")}
      </div>

      <div>
        <label htmlFor="numero">Teléfono *</label> +
        <input
          aria-label="Prefijo"
          size={3}
          maxLength={3}
          inputMode="numeric"
          value={campos.prefijo}
          onChange={(e) => cambiarDigitos("prefijo", e.target.value)}
          onBlur={() => tocar("prefijo")}
        />{" "}
        <input
          id="numero"
          maxLength={14}
          inputMode="numeric"
          value={campos.numero}
          onChange={(e) => cambiarDigitos("numero", e.target.value)}
          onBlur={() => tocar("numero")}
        />
        {mensaje("prefijo")}
        {mensaje("numero")}
      </div>

      <div>
        <label>
          <input
            type="checkbox"
            checked={campos.clienteNuevo}
            onChange={(e) => cambiar("clienteNuevo", e.target.checked)}
          />{" "}
          Cliente nuevo
        </label>
      </div>

      <div>
        <label htmlFor="interes">Interés</label>{" "}
        <select id="interes" value={campos.interes} onChange={(e) => cambiar("interes", e.target.value)}>
          <option value="">Sin indicar</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="origen">Origen</label>{" "}
        <select id="origen" value={campos.origen} onChange={(e) => cambiar("origen", e.target.value)}>
          <option value="">Sin indicar</option>
          {Object.entries(ORIGENES).map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="agente">Asignar a</label>{" "}
        <select id="agente" value={campos.agenteId} onChange={(e) => cambiar("agenteId", e.target.value)}>
          <option value="">Sin asignar</option>
          {asignables.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>

      <p>
        <button type="submit" disabled={hayErrores || guardando}>
          {guardando ? "guardando..." : "Guardar"}
        </button>{" "}
        <button type="button" onClick={onCancelar}>
          Cancelar
        </button>
      </p>

      {errorApi}
    </form>
  );
}

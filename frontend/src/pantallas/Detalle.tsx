import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ErrorApi, pedirApi } from "../api/clienteApi";
import { useApi } from "../api/hookApi";
import { useSesion } from "../api/sesion";
import { Dialogo } from "../componentes/Dialogo";
import { FormularioLead } from "../componentes/FormularioLead";

// describe el agente tal como lo devuelve la api
type Agente = { id: number; nombre: string };

// describe al usuario que ha iniciado sesión
type Usuario = { id: number; rol: "agente" | "admin" };

// describe el lead tal como lo devuelve la api en el detalle
type Lead = {
  id: number;
  nombre: string;
  prefijo: string;
  telefono: string;
  clienteNuevo: boolean;
  interes: number | null;
  origen: string | null;
  estado: string;
  agente: Agente | null;
  version: number;
  creado: string;
  actualizado: string;
  puntuacion: number;
  prioridad: string;
  desglose: { criterio: string; valoracion: number; peso: number; aporte: number }[];
};

// nombres de los estados para mostrarlos al usuario
const ESTADOS: Record<string, string> = {
  nuevo: "Nuevo",
  en_gestion: "En gestión",
  contactado: "Contactado",
  cerrado: "Cerrado",
};

// nombres de las prioridades para mostrarlas al usuario
const PRIORIDADES: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja" };

// nombres de los orígenes para mostrarlos al usuario
const ORIGENES: Record<string, string> = {
  recomendacion: "Recomendación",
  web: "Web",
  anuncio: "Anuncio",
  llamada: "Llamada",
};

// estados a los que se puede pasar desde cada estado (la api es la que decide; esto solo evita ofrecer cambios imposibles)
const TRANSICIONES: Record<string, string[]> = {
  nuevo: ["cerrado"],
  en_gestion: ["contactado", "cerrado"],
  contactado: ["en_gestion", "cerrado"],
  cerrado: ["en_gestion", "contactado"],
};

// convierte una fecha de la api en un texto para mostrarla
function formatearFecha(fecha: string) {
  return new Date(fecha).toLocaleString("es-ES");
}

// pantalla del detalle: datos del lead, desglose de la puntuación, edición y gestión (estado, asignar y liberar)
export function Detalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useSesion();
  const { datos: lead, cargando, error, recargar } = useApi<Lead>(`/leads/${id}`);
  const { datos: yo } = useApi<Usuario>("/me");
  const { datos: agentes } = useApi<{ datos: Agente[] }>("/agentes?rol=agente");

  const [editando, setEditando] = useState(false); // indica si está abierta la ventana de edición
  const [nuevoEstado, setNuevoEstado] = useState("");
  const [agenteElegido, setAgenteElegido] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [conflicto, setConflicto] = useState<string | null>(null); // mensaje cuando otra persona se ha adelantado
  const [errorAccion, setErrorAccion] = useState<ErrorApi | null>(null);

  const esAdmin = yo?.rol === "admin";
  const esMio = lead?.agente?.id === yo?.id;

  // como al editar: el admin, el agente asignado o cualquier agente si el lead no tiene agente
  const puedeGestionar = !!lead && (esAdmin || lead.agente === null || esMio);
  const estadosPosibles = lead ? TRANSICIONES[lead.estado].filter((e) => lead.agente !== null || e === "cerrado") : [];

  // vuelve a la página anterior (el listado con sus filtros)
  function volver() {
    navigate(-1);
  }

  // vuelve a pedir el lead y quita los avisos
  function actualizar() {
    setConflicto(null);
    setErrorAccion(null);
    setNuevoEstado("");
    setAgenteElegido("");
    recargar();
  }

  // avisa de que otra persona ha modificado el lead mientras se editaba
  function avisarConflicto() {
    setEditando(false);
    setConflicto("el lead ha sido modificado por otra persona");
  }

  // lanza una acción sobre el lead con su versión; si va bien recarga y, si da 409, avisa del conflicto
  async function ejecutar(ruta: string, metodo: string, cuerpo: Record<string, unknown>) {
    if (!lead) return;
    setOcupado(true);
    setConflicto(null);
    setErrorAccion(null);

    try {
      await pedirApi(token, `/leads/${lead.id}${ruta}`, { metodo, cuerpo: { ...cuerpo, version: lead.version } });
      actualizar();
    } catch (e) {
      const errorApi = e as ErrorApi;
      if (errorApi.estado === 409) setConflicto(errorApi.message);
      else setErrorAccion(errorApi);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main>
      <p>
        <button onClick={volver}>← Volver</button>
      </p>

      {error && <p>error: {error.message}</p>}
      {cargando && <p>cargando...</p>}

      {/* no se muestran datos si hay error para no enseñar datos antiguos */}
      {!error && lead && (
        <>
          <h1>{lead.nombre}</h1>

          {/* aviso de conflicto: otra persona modificó el lead antes */}
          {conflicto && (
            <p role="alert">
              {conflicto}. <button onClick={actualizar}>Recargar</button>
            </p>
          )}

          {/* datos del lead */}
          <section>
            <h2>Datos</h2>
            <dl>
              <dt>Teléfono</dt>
              <dd>
                +{lead.prefijo} {lead.telefono}
              </dd>
              <dt>Cliente nuevo</dt>
              <dd>{lead.clienteNuevo ? "Sí" : "No"}</dd>
              <dt>Interés</dt>
              <dd>{lead.interes ?? "Sin indicar"}</dd>
              <dt>Origen</dt>
              <dd>{lead.origen ? (ORIGENES[lead.origen] ?? lead.origen) : "Sin indicar"}</dd>
              <dt>Estado</dt>
              <dd>{ESTADOS[lead.estado] ?? lead.estado}</dd>
              <dt>Agente</dt>
              <dd>{lead.agente?.nombre ?? "Sin asignar"}</dd>
              <dt>Creado</dt>
              <dd>{formatearFecha(lead.creado)}</dd>
              <dt>Última modificación</dt>
              <dd>{formatearFecha(lead.actualizado)}</dd>
            </dl>
            {/* solo se puede editar si se puede gestionar el lead */}
            {puedeGestionar && <button onClick={() => setEditando(true)}>Editar</button>}
          </section>

          {/* ventana de edición: reutiliza el formulario de crear */}
          {editando && (
            <Dialogo titulo="Editar lead" onCerrar={() => setEditando(false)}>
              <FormularioLead
                lead={lead}
                onGuardado={() => {
                  setEditando(false);
                  actualizar();
                }}
                onCancelar={() => setEditando(false)}
                onConflicto={avisarConflicto}
              />
            </Dialogo>
          )}

          {/* puntuación y desglose */}
          <section>
            <h2>
              Puntuación: {lead.puntuacion} / {PRIORIDADES[lead.prioridad] ?? lead.prioridad}
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Criterio</th>
                  <th>Valoración</th>
                  <th>Peso</th>
                  <th>Aporte</th>
                </tr>
              </thead>
              <tbody>
                {lead.desglose.map((c) => (
                  <tr key={c.criterio}>
                    <td>{c.criterio}</td>
                    <td>{c.valoracion}</td>
                    <td>{c.peso} %</td>
                    <td>{c.aporte}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* gestión: cambiar el estado, asignar y liberar */}
          {puedeGestionar && (
            <section>
              <h2>Gestión</h2>

              {/* cambio de estado con solo los cambios permitidos */}
              <div>
                <label htmlFor="estado">Cambiar estado a</label>{" "}
                <select id="estado" value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value)}>
                  <option value="">Elige un estado</option>
                  {estadosPosibles.map((e) => (
                    <option key={e} value={e}>
                      {ESTADOS[e]}
                    </option>
                  ))}
                </select>{" "}
                <button disabled={!nuevoEstado || ocupado} onClick={() => ejecutar("/estado", "PUT", { estado: nuevoEstado })}>
                  Cambiar
                </button>
              </div>

              {/* el admin asigna o reasigna a cualquier agente */}
              {esAdmin && (
                <div>
                  <label htmlFor="agente">{lead.agente ? "Reasignar a" : "Asignar a"}</label>{" "}
                  <select id="agente" value={agenteElegido} onChange={(e) => setAgenteElegido(e.target.value)}>
                    <option value="">Elige un agente</option>
                    {agentes?.datos.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nombre}
                      </option>
                    ))}
                  </select>{" "}
                  <button
                    disabled={!agenteElegido || ocupado}
                    onClick={() => ejecutar("/asignar", "POST", { agenteId: Number(agenteElegido) })}
                  >
                    {lead.agente ? "Reasignar" : "Asignar"}
                  </button>
                </div>
              )}

              {/* un agente solo puede asignarse un lead libre */}
              {!esAdmin && lead.agente === null && yo && (
                <div>
                  <button disabled={ocupado} onClick={() => ejecutar("/asignar", "POST", { agenteId: yo.id })}>
                    Asignármelo
                  </button>
                </div>
              )}

              {/* se puede liberar un lead que tiene agente */}
              {lead.agente && (
                <div>
                  <button disabled={ocupado} onClick={() => ejecutar("/liberar", "POST", {})}>
                    Liberar
                  </button>
                </div>
              )}

              {errorAccion && (
                <div role="alert">
                  <p>error: {errorAccion.message}</p>
                  <ul>
                    {errorAccion.detalles.map((detalle, i) => (
                      <li key={i}>
                        {detalle.campo && `${detalle.campo}: `}
                        {detalle.mensaje}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

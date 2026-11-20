import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi } from "../api/hookApi";
import { Dialogo } from "../componentes/Dialogo";
import { FormularioLead } from "../componentes/FormularioLead";

// describe el agente tal como lo devuelve la api
type Agente = { id: number; nombre: string };

// describe el lead tal como lo devuelve la api en el listado
type Lead = {
  id: number;
  nombre: string;
  telefono: string;
  estado: string;
  agente: Agente | null;
  puntuacion: number;
  prioridad: string;
};

// describe la respuesta paginada de GET /leads
type RespuestaLeads = { datos: Lead[]; total: number; pagina: number; limite: number };

// nombres de los estados para mostrarlos al usuario
const ESTADOS: Record<string, string> = {
  nuevo: "Nuevo",
  en_gestion: "En gestión",
  contactado: "Contactado",
  cerrado: "Cerrado",
};

// nombres de las prioridades para mostrarlas al usuario
const PRIORIDADES: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja" };

// leads por página
const LIMITE = 20;

// milisegundos que se espera tras la última tecla antes de buscar
const RETRASO_BUSQUEDA = 400;

// pantalla del listado: buscador, filtros, tabla ordenada por puntuación y paginación
export function Listado() {
  // búsqueda, filtros y página viven en la dirección para conservarlos al volver desde el detalle
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const estado = params.get("estado") ?? "";
  const agente = params.get("agente") ?? "";
  const pagina = Math.max(1, Number(params.get("pagina")) || 1);

  // texto del buscador mientras se escribe, antes de pasarlo a la dirección
  const [texto, setTexto] = useState(q);

  // indica si está abierta la ventana para crear un lead
  const [creando, setCreando] = useState(false);

  // pasa el texto a la dirección cuando el usuario deja de escribir
  useEffect(() => {
    if (texto === q) return;
    const temporizador = setTimeout(() => {
      cambiarParams({ q: texto });
    }, RETRASO_BUSQUEDA);
    return () => clearTimeout(temporizador);
  }, [texto]);

  // actualiza la dirección con los cambios y vuelve a la página 1 salvo que se cambie la página
  function cambiarParams(cambios: Record<string, string>) {
    const nuevos = new URLSearchParams(params);
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) nuevos.set(clave, valor);
      else nuevos.delete(clave);
    }
    if (!("pagina" in cambios)) nuevos.delete("pagina");
    setParams(nuevos);
  }

  // construye la ruta de la api con los filtros activos
  const consulta = new URLSearchParams({ limite: String(LIMITE), pagina: String(pagina) });
  if (q) consulta.set("q", q);
  if (estado) consulta.set("estado", estado);
  if (agente) consulta.set("agente", agente);

  const { datos: respuesta, cargando, error, recargar } = useApi<RespuestaLeads>(`/leads?${consulta}`);
  const { datos: agentes } = useApi<{ datos: Agente[] }>("/agentes?rol=agente");

  const total = respuesta?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));
  const desde = total === 0 ? 0 : (pagina - 1) * LIMITE + 1;
  const hasta = Math.min(pagina * LIMITE, total);

  return (
    <main className="pagina">
      {/* título y botón para crear un lead */}
      <div className="encabezado">
        <div>
          <p className="sobretitulo">Gestión comercial</p>
          <h1>Leads</h1>
        </div>
        <button className="boton principal" onClick={() => setCreando(true)}>
          + Nuevo lead
        </button>
      </div>

      {/* buscador y filtros */}
      <div className="filtros">
        <label className="buscador">
          <span className="icono-lupa" aria-hidden="true"></span>
          <input
            type="search"
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar por nombre o teléfono"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        <select aria-label="Filtrar por estado" value={estado} onChange={(e) => cambiarParams({ estado: e.target.value })}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
        <select aria-label="Filtrar por agente" value={agente} onChange={(e) => cambiarParams({ agente: e.target.value })}>
          <option value="">Todos los agentes</option>
          <option value="sin">Sin agente</option>
          {agentes?.datos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* ventana para crear un lead: al guardar se cierra y se recarga la lista */}
      {creando && (
        <Dialogo titulo="Nuevo lead" onCerrar={() => setCreando(false)}>
          <FormularioLead
            onGuardado={() => {
              setCreando(false);
              recargar();
            }}
            onCancelar={() => setCreando(false)}
          />
        </Dialogo>
      )}

      {error && (
        <p className="error">
          error: {error.message}{" "}
          <button className="boton secundario" onClick={recargar}>
            Reintentar
          </button>
        </p>
      )}
      {cargando && <p className="cargando">cargando...</p>}

      {/* no se muestra la tabla si hay error para no enseñar datos antiguos */}
      {!error && respuesta && (
        <>
          {respuesta.datos.length === 0 ? (
            <p className="vacio">No hay leads con estos filtros</p>
          ) : (
            // la tabla se ve como tarjetas en móvil (ver tabla-leads en estilos.css)
            <div className="tabla-caja">
              <table className="tabla-leads">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Estado</th>
                    <th>Agente asignado</th>
                    <th>Score / prioridad</th>
                    <th className="columna-accion">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {respuesta.datos.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <Link className="nombre-lead" to={`/leads/${lead.id}`}>
                          {lead.nombre}
                        </Link>
                        <small>{lead.telefono}</small>
                      </td>
                      <td>
                        <span className={`pastilla ${lead.estado}`}>{ESTADOS[lead.estado] ?? lead.estado}</span>
                      </td>
                      <td>{lead.agente?.nombre ?? <span className="suave">Sin asignar</span>}</td>
                      <td>
                        <span className="puntuacion">{lead.puntuacion}</span>
                        <span className={`pastilla ${lead.prioridad}`}>{PRIORIDADES[lead.prioridad] ?? lead.prioridad}</span>
                      </td>
                      <td className="columna-accion">
                        <Link className="enlace" to={`/leads/${lead.id}`}>
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* paginación */}
          <p className="paginacion">
            <button
              className="boton secundario"
              disabled={pagina <= 1}
              onClick={() => cambiarParams({ pagina: String(pagina - 1) })}
            >
              Anterior
            </button>
            <span>
              {desde} a {hasta} de {total}
            </span>
            <button
              className="boton secundario"
              disabled={pagina >= totalPaginas}
              onClick={() => cambiarParams({ pagina: String(pagina + 1) })}
            >
              Siguiente
            </button>
          </p>
        </>
      )}
    </main>
  );
}

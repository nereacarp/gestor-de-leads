import { Link, Route, Routes, useLocation } from "react-router";
import { Detalle } from "./pantallas/Detalle";
import { Listado } from "./pantallas/Listado";
import { Pesos } from "./pantallas/Pesos";
import { TOKENS, useSesion } from "./api/sesion";
import { useApi } from "./api/hookApi";

// describe el usuario que devuelve /me
type Usuario = { id: number; nombre: string; rol: "agente" | "admin" };

// nombres de los roles para mostrarlos al usuario
const ROLES: Record<string, string> = { admin: "Administrador", agente: "Agente comercial" };

// muestra la cabecera con el menú, el selector de usuario y quién es el usuario actual
function Cabecera() {
  const { token, cambiarToken } = useSesion();
  const { datos: usuario, cargando, error } = useApi<Usuario>("/me");
  const enPesos = useLocation().pathname.startsWith("/pesos");

  return (
    <header className="cabecera">
      <div className="cabecera-interior">
        {/* muestra el menú de navegación */}
        <nav className="menu">
          <Link className={enPesos ? "enlace-menu" : "enlace-menu activo"} to="/">
            Leads
          </Link>
          {/* muestra el enlace a los pesos solo al admin */}
          {!cargando && usuario?.rol === "admin" && (
            <Link className={enPesos ? "enlace-menu activo" : "enlace-menu"} to="/pesos">
              Pesos
            </Link>
          )}
        </nav>

        <div className="usuario">
          {/* permite cambiar de usuario */}
          <label htmlFor="usuario-prueba">Usuario de prueba</label>
          <select id="usuario-prueba" value={token} onChange={(e) => cambiarToken(e.target.value)}>
            {TOKENS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {/* muestra la carga, el error o el usuario actual */}
          <span className="usuario-datos">
            {cargando && <small>cargando...</small>}
            {error && <small>error: {error.message}</small>}
            {!cargando && usuario && (
              <>
                <strong>{usuario.nombre}</strong>
                <small>{ROLES[usuario.rol] ?? usuario.rol}</small>
              </>
            )}
          </span>
        </div>
      </div>
    </header>
  );
}

// define la cabecera y qué pantalla se ve según la dirección
export function App() {
  return (
    <>
      <Cabecera />
      <Routes>
        <Route path="/" element={<Listado />} />
        <Route path="/leads/:id" element={<Detalle />} />
        <Route path="/pesos" element={<Pesos />} />
        <Route path="*" element={<main className="pagina">página no encontrada</main>} />
      </Routes>
    </>
  );
}

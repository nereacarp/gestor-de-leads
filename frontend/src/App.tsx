import { Link, Route, Routes } from "react-router";
import { Detalle } from "./pantallas/Detalle";
import { Listado } from "./pantallas/Listado";
import { Pesos } from "./pantallas/Pesos";
import { TOKENS, useSesion } from "./api/sesion";
import { useApi } from "./api/hookApi";

// describe el usuario que devuelve /me
type Usuario = { id: number; nombre: string; rol: "agente" | "admin" };

// muestra la cabecera con el menú, el selector de usuario y quién es el usuario actual
function Cabecera() {
  const { token, cambiarToken } = useSesion();
  const { datos: usuario, cargando, error } = useApi<Usuario>("/me");

  return (
    <header>
      {/* muestra el menú de navegación */}
      <nav>
        <Link to="/">Leads</Link> <Link to="/pesos">Pesos</Link>
      </nav>
      {/* permite cambiar de usuario */}
      <label>
        Usuario:{" "}
        <select value={token} onChange={(e) => cambiarToken(e.target.value)}>
          {TOKENS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>{" "}
      {/* muestra la carga, el error o el usuario actual */}
      <span>
        {cargando && "cargando..."}
        {error && `error: ${error.message}`}
        {!cargando && usuario && `${usuario.nombre} (${usuario.rol})`}
      </span>
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
        <Route path="*" element={<p>página no encontrada</p>} />
      </Routes>
    </>
  );
}

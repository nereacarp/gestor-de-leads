import { createContext, useContext, useState, type ReactNode } from "react";

// tokens de los usuarios del seed
export const TOKENS = ["admin-01", "agente-01", "agente-02", "agente-03"];

// describe lo que comparte la sesión (el token y cómo cambiarlo)
type Sesion = { token: string; cambiarToken: (token: string) => void };

// crea el contexto donde se guarda la sesión para que cualquier componente la lea
const SesionContext = createContext<Sesion | null>(null);

// guarda el token del usuario actual y lo comparte con toda la aplicación
export function SesionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem("token") ?? "agente-01");

  function cambiarToken(nuevo: string) {
    localStorage.setItem("token", nuevo);
    setToken(nuevo);
  }

  return <SesionContext.Provider value={{ token, cambiarToken }}>{children}</SesionContext.Provider>;
}

// devuelve el token actual y la función para cambiarlo
export function useSesion() {
  const sesion = useContext(SesionContext);
  if (!sesion) throw new Error("useSesion se tiene que usar dentro de SesionProvider");
  return sesion;
}

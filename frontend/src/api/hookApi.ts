import { useEffect, useState } from "react";
import { ErrorApi, pedirApi } from "./clienteApi";
import { useSesion } from "./sesion";

// pide datos a la API con el token y devuelve en que estado está la petición (cargando, error o datos)
export function useApi<T>(ruta: string) {
  const { token } = useSesion();
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [cargando, setCargando] = useState(true);

  // pide los datos cada vez que cambia el token o la ruta
  useEffect(() => {
    // evita guardar una respuesta antigua si mientras tanto ha cambiado la ruta o el token
    let cancelado = false;
    setCargando(true);
    setError(null);

    pedirApi<T>(token, ruta)
      .then((respuesta) => {
        if (!cancelado) setDatos(respuesta);
      })
      .catch((e: ErrorApi) => {
        if (!cancelado) setError(e);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [token, ruta]);

  return { datos, cargando, error };
}

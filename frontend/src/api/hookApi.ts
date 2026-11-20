import { useEffect, useState } from "react";
import { ErrorApi, pedirApi } from "./clienteApi";
import { useSesion } from "./sesion";

// pide datos a la API con el token y devuelve en que estado está la petición (cargando, error o datos)
export function useApi<T>(ruta: string) {
  const { token } = useSesion();
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0); // sube cada vez que se pide recargar, para volver a pedir los datos

  // pide los datos cada vez que cambia el token, la ruta o la versión
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
  }, [token, ruta, version]);

  // vuelve a pedir los datos de la misma ruta
  function recargar() {
    setVersion((v) => v + 1);
  }

  return { datos, cargando, error, recargar };
}

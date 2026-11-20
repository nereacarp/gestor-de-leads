// describe cómo es un problema de validación (campo y mensaje)
type Detalle = { campo: string; mensaje: string };

// crea un error de la api con su mensaje, código y detalles
export class ErrorApi extends Error {
  estado: number;
  detalles: Detalle[];

  constructor(estado: number, mensaje: string, detalles: Detalle[] = []) {
    super(mensaje);
    this.estado = estado;
    this.detalles = detalles;
  }
}

// describe las opciones de la petición (método y cuerpo opcional)
type Opciones = { metodo?: string; cuerpo?: unknown };

// hace una petición a la api con el token del usuario y devuelve el json
export async function pedirApi<T>(token: string, ruta: string, opciones: Opciones = {}): Promise<T> {
  // añade el cuerpo y la cabecera de json solo si hay datos que enviar
  const conCuerpo = opciones.cuerpo !== undefined;

  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: opciones.metodo ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(conCuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: conCuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  } catch {
    // avisa de que la petición no ha llegado al servidor
    throw new ErrorApi(0, "no se puede conectar con el servidor");
  }

  // lee el json de la respuesta
  const cuerpo = await respuesta.json().catch(() => null);
  // si la api responde con un error, lo lanza con su código y sus detalles
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status, cuerpo?.error ?? "error inesperado", cuerpo?.detalles);
  }
  return cuerpo as T;
}

import { useEffect, useRef, type ReactNode } from "react";

// muestra su contenido en una ventana emergente y avisa cuando se cierra
export function Dialogo({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  // abre la ventana en modo modal (bloquea el resto de la pantalla) al aparecer
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} onClose={onCerrar}>
      <h2>{titulo}</h2>
      {children}
    </dialog>
  );
}

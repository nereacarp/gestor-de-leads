import { useEffect, useRef, type ReactNode } from "react";

// muestra su contenido en una ventana emergente y avisa cuando se cierra
export function Dialogo({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  // abre la ventana en modo modal (bloquea el resto de la pantalla) al aparecer y pone el cursor en el primer campo
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    ref.current?.querySelector("input")?.focus();
  }, []);

  return (
    <dialog ref={ref} onClose={onCerrar}>
      <div className="dialogo-cabecera">
        <h2>{titulo}</h2>
        {/* close() lanza el evento close, que avisa a la pantalla */}
        <button type="button" className="cerrar" aria-label="Cerrar" onClick={() => ref.current?.close()}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

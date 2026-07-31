"use client";

/**
 * Botón "Cierre de día" con el asistente de cierre en una ventana emergente.
 *
 * Quien fija los objetivos suele cerrar también su propio día, y hasta ahora
 * eso obligaba a irse de la pantalla de objetivos hasta `/empleado/cierre-turno`
 * y volver. Aquí es el MISMO asistente de siempre (ventas del día, cómo vas de
 * objetivos, cierre de caja e incidencias), montado dentro de un diálogo: no
 * hay una segunda versión del proceso que mantener.
 *
 * El asistente se monta solo al abrir —Radix desmonta el contenido del diálogo
 * al cerrarlo—, así que cada vez recupera el cierre de hoy tal y como esté y no
 * gasta peticiones mientras la ventana está cerrada.
 */

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AsistenteCierre } from "@/components/cierre-turno/asistente-cierre";

export function BotonCierreDia({
  onCambios,
}: {
  /** Se llama al cerrar la ventana si dentro se guardó algo (ventas, caja o el
   *  cierre del turno): lo de detrás está viejo y toca refrescarlo. */
  onCambios?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [huboCambios, setHuboCambios] = useState(false);

  const cerrar = () => {
    setAbierto(false);
    if (huboCambios) {
      setHuboCambios(false);
      onCambios?.();
    }
  };

  return (
    <>
      <Button onClick={() => setAbierto(true)}>
        <ClipboardList className="h-4 w-4" />
        Cierre de día
      </Button>

      <Dialog open={abierto} onOpenChange={(o) => (o ? setAbierto(true) : cerrar())}>
        <DialogContent className="grid-cols-1 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-[var(--primary)]" /> Cierre de día
            </DialogTitle>
            <DialogDescription>
              Tus ventas de hoy, cómo vas de objetivos y el cierre de tu caja, sin salir de
              esta pantalla.
            </DialogDescription>
          </DialogHeader>

          <AsistenteCierre enDialogo onGuardado={() => setHuboCambios(true)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

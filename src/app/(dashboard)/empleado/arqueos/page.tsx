import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// Misma pantalla que en administración, limitada por el servidor a su sede.
export default function EmpleadoArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="El último día que abre tu tienda, quien la cierra cuenta el efectivo acumulado y lo mete en un sobre para que lo recoja un responsable. El fondo de cambio se queda en el cajón: no se cuenta."
    />
  );
}

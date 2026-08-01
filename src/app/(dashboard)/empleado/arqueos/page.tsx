import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// Misma pantalla que en administración, limitada por el servidor a su sede.
export default function EmpleadoArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="Los domingos, cuenta el efectivo acumulado, mételo en un sobre y regístralo aquí para que lo recoja un responsable. El fondo de cambio se queda en el cajón: no se cuenta."
    />
  );
}

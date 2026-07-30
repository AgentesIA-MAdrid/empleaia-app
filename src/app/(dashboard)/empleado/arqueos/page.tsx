import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// Misma pantalla que en administración, limitada por el servidor a su sede.
export default function EmpleadoArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="Registra el efectivo que apartas cada semana para que lo recoja un superior. Al lado verás lo que suman tus cierres de esos días."
    />
  );
}

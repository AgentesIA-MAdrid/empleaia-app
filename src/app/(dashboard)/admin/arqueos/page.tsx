import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// Lo que cada rol puede hacer lo decide el servidor, no la ruta.
export default function AdminArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="El efectivo acumulado de cada punto de venta, lo que se apartó en el sobre y la recogida firmada con PIN. El fondo de cambio no entra: no se arquea."
    />
  );
}

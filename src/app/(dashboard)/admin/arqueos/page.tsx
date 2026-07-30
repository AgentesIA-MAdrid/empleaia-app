import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// Lo que cada rol puede hacer lo decide el servidor, no la ruta.
export default function AdminArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="Retiradas semanales de efectivo por punto de venta, con la diferencia contra los cierres de caja y la recogida firmada con PIN."
    />
  );
}

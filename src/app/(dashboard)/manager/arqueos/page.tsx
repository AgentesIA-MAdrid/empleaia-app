import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// El coordinador ve y declara el arqueo de su sede; el servidor lo limita.
export default function ManagerArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="El efectivo que aparta tu sede cada semana, la diferencia con los cierres de caja y la recogida firmada."
    />
  );
}

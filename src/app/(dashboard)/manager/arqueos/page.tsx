import { PanelArqueos } from "@/components/cierre-turno/panel-arqueos";

// El coordinador ve y declara el arqueo de su sede; el servidor lo limita.
export default function ManagerArqueosPage() {
  return (
    <PanelArqueos
      titulo="Arqueos"
      descripcion="El efectivo acumulado de tu sede, lo que se aparta en el sobre cada domingo y la recogida firmada. El fondo de cambio no entra: no se arquea."
    />
  );
}

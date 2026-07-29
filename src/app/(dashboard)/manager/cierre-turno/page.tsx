import { PanelCierres } from "@/components/cierre-turno/panel-cierres";

// Mismo panel que administración; el servidor lo limita a la sede del coordinador.
export default function ManagerCierreTurnoPage() {
  return <PanelCierres titulo="Cierre de turno de mi sede" />;
}

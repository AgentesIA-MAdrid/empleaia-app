import { PanelConciliacion } from "@/components/cierre-turno/panel-conciliacion";

// Solo administración: cruza el extracto de la cuenta de la empresa. El
// servidor lo comprueba; la ruta no basta.
export default function AdminConciliacionPage() {
  return <PanelConciliacion />;
}

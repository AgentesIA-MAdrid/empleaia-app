import { PanelCierres } from "@/components/cierre-turno/panel-cierres";

// El alcance (todas las sedes) lo resuelve el servidor por el rol, no la ruta.
export default function AdminCierreTurnoPage() {
  return <PanelCierres titulo="Cierre de turno" />;
}

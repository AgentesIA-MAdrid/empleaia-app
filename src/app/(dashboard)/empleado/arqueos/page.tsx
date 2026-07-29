import { AreaPendiente } from "@/components/cierre-turno/area-pendiente";

export default function EmpleadoArqueosPage() {
  return (
    <AreaPendiente
      titulo="Arqueos"
      descripcion="Registra el efectivo que apartas cada semana para que lo recoja un superior."
      entrega="entrega 4"
      filtros={["Semana"]}
      columnas={["Semana", "Efectivo apartado", "Estado", "Recogido por", "Fecha de recogida"]}
      nota="Al registrarlo verás al lado lo que suman tus cierres diarios de esa semana, para que cualquier diferencia salte en el momento."
    />
  );
}

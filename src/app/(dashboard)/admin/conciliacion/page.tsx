import { AreaPendiente } from "@/components/cierre-turno/area-pendiente";

export default function AdminConciliacionPage() {
  return (
    <AreaPendiente
      titulo="Conciliación"
      descripcion="Cuadra el efectivo de los cierres con los arqueos, y los cobros con datáfono con los movimientos del banco."
      entrega="entrega 4"
      filtros={["Periodo", "Punto de venta", "Tipo de cobro"]}
      columnas={["Sede", "Periodo", "Según cierres", "Según arqueo o banco", "Diferencia"]}
      nota="Los movimientos del banco se cargan desde su Excel. Las diferencias por debajo de un euro no se marcan como descuadre: son redondeos y llenarían la pantalla de ruido."
    />
  );
}

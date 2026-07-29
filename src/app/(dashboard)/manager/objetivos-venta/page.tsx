import { AreaPendiente } from "@/components/cierre-turno/area-pendiente";

export default function ManagerObjetivosVentaPage() {
  return (
    <AreaPendiente
      titulo="Objetivos de venta"
      descripcion="Consulta cómo va tu sede y cada comercial frente a los objetivos del mes. Los objetivos los fija administración."
      entrega="entrega 3"
      filtros={["Mes", "Comercial", "Artículo"]}
      columnas={["Comercial", "Artículo", "Objetivo", "Vendido", "Consecución"]}
    />
  );
}

import { AreaPendiente } from "@/components/cierre-turno/area-pendiente";

export default function AdminObjetivosVentaPage() {
  return (
    <AreaPendiente
      titulo="Objetivos de venta"
      descripcion="Fija los objetivos de cada comercial y de cada punto de venta, y consulta la consecución en tiempo real."
      entrega="entrega 3"
      filtros={["Mes", "Comercial", "Punto de venta", "Artículo"]}
      columnas={["Comercial o sede", "Artículo", "Objetivo", "Vendido", "Consecución"]}
      nota={
        <>
          Los objetivos se fijan por mes y pueden ser de una persona o de una sede completa.
          Es distinto del área <strong>Objetivos</strong> de recursos humanos, que sigue
          sirviendo para los OKR con avance manual.
        </>
      }
    />
  );
}

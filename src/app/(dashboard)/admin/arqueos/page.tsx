import { AreaPendiente } from "@/components/cierre-turno/area-pendiente";

export default function AdminArqueosPage() {
  return (
    <AreaPendiente
      titulo="Arqueos"
      descripcion="Retiradas semanales de efectivo por punto de venta y su recogida firmada por un superior."
      entrega="entrega 4"
      filtros={["Semana", "Punto de venta", "Estado"]}
      columnas={["Semana", "Sede", "Declarado", "Según cierres", "Diferencia", "Recogido por"]}
      nota={
        <>
          Quién puede firmar una recogida y con qué PIN se configura en administración: no
          basta con el rol. El PIN se guarda cifrado, nunca en claro.
        </>
      }
    />
  );
}

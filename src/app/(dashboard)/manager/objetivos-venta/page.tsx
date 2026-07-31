import { ObjetivosVentaArea } from "@/components/cierre-turno/objetivos-venta-area";

// Misma pantalla que en administración: el servidor la sirve en modo lectura y
// limitada a las sedes del coordinador.
export default function ManagerObjetivosVentaPage() {
  return (
    <ObjetivosVentaArea
      titulo="Objetivos de venta"
      descripcion="Cómo van tus sedes y cada comercial frente a los objetivos del mes, con el seguimiento día a día. Los objetivos los fija administración."
    />
  );
}

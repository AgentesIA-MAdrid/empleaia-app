import { ObjetivosVenta } from "@/components/cierre-turno/objetivos-venta";

// Misma pantalla que en administración: el servidor la sirve en modo lectura y
// limitada a la sede del coordinador.
export default function ManagerObjetivosVentaPage() {
  return (
    <ObjetivosVenta
      titulo="Objetivos de venta"
      descripcion="Cómo va tu sede y cada comercial frente a los objetivos del mes. Los objetivos los fija administración."
    />
  );
}

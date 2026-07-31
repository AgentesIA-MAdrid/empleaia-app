import { ObjetivosVentaArea } from "@/components/cierre-turno/objetivos-venta-area";

// Quién puede escribir lo decide el servidor por el rol, no la ruta.
export default function AdminObjetivosVentaPage() {
  return (
    <ObjetivosVentaArea
      titulo="Objetivos de venta"
      descripcion="Define los objetivos del mes de cada comercial y de cada punto de venta, y sigue día a día cómo van."
      // Administración cierra su propio día desde aquí, en una ventana
      // emergente, sin irse de la pantalla de objetivos.
      mostrarCierreDia
    />
  );
}

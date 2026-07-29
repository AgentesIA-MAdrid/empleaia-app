import { ObjetivosVenta } from "@/components/cierre-turno/objetivos-venta";

// Quién puede escribir lo decide el servidor por el rol, no la ruta.
export default function AdminObjetivosVentaPage() {
  return (
    <ObjetivosVenta
      titulo="Objetivos de venta"
      descripcion="Fija los objetivos de cada comercial y de cada punto de venta, y mira la consecución del mes en tiempo real."
    />
  );
}

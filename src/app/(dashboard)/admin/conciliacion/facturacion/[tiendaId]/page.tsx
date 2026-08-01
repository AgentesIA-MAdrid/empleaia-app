import { CuadreExterno } from "@/components/cierre-turno/cuadre-externo";
import { primerYUltimoDiaDelMes } from "@/lib/cierre-turno/rango-mes";

// Solo administración: el servidor lo comprueba, la ruta no basta.
export default async function CuadreFacturacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ tiendaId: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { tiendaId } = await params;
  const q = await searchParams;
  const porDefecto = primerYUltimoDiaDelMes();
  return (
    <CuadreExterno
      tiendaId={tiendaId}
      desdeInicial={q.desde || porDefecto.desde}
      hastaInicial={q.hasta || porDefecto.hasta}
      endpoint="facturacion"
      // La venta se factura cuando se hace: aquí no hay liquidación de por medio.
      desfaseInicial={0}
      textos={{
        titulo: "Facturado",
        descripcion:
          "Lo que la tienda declaró haber cobrado cada día (efectivo y tarjeta), frente a lo que consta facturado en el sistema del operador. Sirve para ver si una venta declarada se quedó sin tramitar, o si se ha facturado algo que nadie declaró.",
        fuente: "Facturación",
        etiquetaDeclarado: "Declarado en cierres",
        etiquetaFuente: "Consta facturado",
        columnaFechaFuente: "Fecha en facturación",
        sinDatos:
          "No hay líneas de facturación de esta tienda en estas fechas. Sube el Excel del sistema de facturación para poder cuadrar: sin él, todo aparecería como si no se hubiera facturado nada.",
        tituloFichero: "Líneas de facturación importadas",
      }}
    />
  );
}

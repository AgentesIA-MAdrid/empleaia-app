import { CuadreExterno } from "@/components/cierre-turno/cuadre-externo";
import { primerYUltimoDiaDelMes } from "@/lib/cierre-turno/rango-mes";

// Solo administración: el servidor lo comprueba, la ruta no basta.
export default async function CuadreTarjetaPage({
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
      endpoint="tarjeta"
      // Las liquidaciones del datáfono entran al día siguiente.
      desfaseInicial={1}
      textos={{
        titulo: "Tarjeta",
        descripcion:
          "Lo que la tienda declaró haber cobrado con el datáfono cada día, frente a lo que entró en el banco. El dinero de un día aparece en el extracto al día siguiente, así que cada fila compara las dos fechas.",
        fuente: "El banco",
        etiquetaDeclarado: "Declarado en cierres",
        etiquetaFuente: "Ingresado por el banco",
        columnaFechaFuente: "Ingreso del banco",
        sinDatos:
          "No hay movimientos del banco de esta tienda en estas fechas. Importa el extracto desde la pantalla de Conciliación para poder cuadrar: sin él, todo aparecería como si faltara el dinero.",
        tituloFichero: "Movimientos del banco importados",
      }}
    />
  );
}

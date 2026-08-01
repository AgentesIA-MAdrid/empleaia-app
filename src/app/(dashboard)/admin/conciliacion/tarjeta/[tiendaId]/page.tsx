import { CuadreTarjeta } from "@/components/cierre-turno/cuadre-tarjeta";
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
    <CuadreTarjeta
      tiendaId={tiendaId}
      desdeInicial={q.desde || porDefecto.desde}
      hastaInicial={q.hasta || porDefecto.hasta}
    />
  );
}

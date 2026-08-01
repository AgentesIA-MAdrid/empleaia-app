import { LibroCaja } from "@/components/cierre-turno/libro-caja";
import { primerYUltimoDiaDelMes } from "@/lib/cierre-turno/rango-mes";

// Solo administración: el servidor lo comprueba, la ruta no basta.
export default async function LibroCajaPage({
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
    <LibroCaja
      tiendaId={tiendaId}
      desdeInicial={q.desde || porDefecto.desde}
      hastaInicial={q.hasta || porDefecto.hasta}
    />
  );
}

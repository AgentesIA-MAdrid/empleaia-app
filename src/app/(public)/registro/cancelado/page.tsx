import Link from "next/link";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
      <main className="text-center max-w-md w-full">
        <div className="flex justify-center mb-6">
          <EmpleaIALogo symbolSize={80} />
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm px-8 py-10">
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Has cancelado el pago</h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">No se ha cargado nada a tu tarjeta.</p>
          <Link
            href="/registro"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors"
          >
            Volver al registro
          </Link>
        </div>
      </main>
    </div>
  );
}

import { Briefcase, Plus } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import {
  ESTADO_OFERTA_LABEL,
  ESTADO_OFERTA_TONE,
  formatSalary,
} from "@/lib/reclutamiento/labels";

async function ReclutamientoPage() {
  const ofertas = await prismaApp.ofertaTrabajo.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      _count: { select: { candidatos: true } },
    },
  });

  const abiertas = ofertas.filter((o) => o.estado === "abierta").length;
  const totalCandidatos = ofertas.reduce((acc, o) => acc + o._count.candidatos, 0);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <Briefcase className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              Reclutamiento
            </h1>
            <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
              Pipeline de selección de talento
            </p>
          </div>
        </div>
        <Link
          href="/admin/reclutamiento/nueva"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nueva oferta
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-[var(--card)] p-4">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase">Ofertas</p>
          <p className="text-2xl font-bold mt-1">{ofertas.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-4">
          <p className="text-xs font-medium text-[var(--success-text)] uppercase">Abiertas</p>
          <p className="text-2xl font-bold mt-1 text-[var(--success-text)]">{abiertas}</p>
        </div>
        <div className="rounded-lg border border-[var(--primary)]/20 bg-[var(--primary)]/5 p-4">
          <p className="text-xs font-medium text-[var(--primary)] uppercase">Candidatos</p>
          <p className="text-2xl font-bold mt-1 text-[var(--primary-dark,#4f46e5)]">{totalCandidatos}</p>
        </div>
      </div>

      {ofertas.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-[var(--card)] p-12 text-center">
          <Briefcase className="h-10 w-10 mx-auto text-[var(--text-muted)]" />
          <p className="mt-3 text-sm text-[var(--color-text-body,#475569)]">
            Aún no hay ofertas creadas. Empieza con la primera.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ofertas.map((o) => (
            <Link
              key={o.id}
              href={`/admin/reclutamiento/${o.id}`}
              className="rounded-lg border bg-[var(--card)] p-5 hover:border-[var(--primary)] hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-[var(--color-text-dark,#0F172A)]">
                  {o.titulo}
                </h3>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_OFERTA_TONE[o.estado]}`}>
                  {ESTADO_OFERTA_LABEL[o.estado]}
                </span>
              </div>
              <div className="mt-2 flex items-center flex-wrap gap-2 text-xs text-[var(--text-body)]">
                {o.departamento && <span>{o.departamento}</span>}
                {o.ubicacion && <span>· {o.ubicacion}</span>}
                {o.modalidad && <span>· {o.modalidad}</span>}
              </div>
              {(o.salarioMinCents || o.salarioMaxCents) && (
                <p className="mt-2 text-xs text-[var(--text-body)]">
                  {formatSalary(o.salarioMinCents, o.salarioMaxCents)}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>{o._count.candidatos} candidato{o._count.candidatos === 1 ? "" : "s"}</span>
                <span>{new Date(o.createdAt).toLocaleDateString("es-ES")}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default withTenantPage(ReclutamientoPage);

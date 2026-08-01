import { notFound } from "next/navigation";
import Link from "next/link";
import { Briefcase, ArrowLeft } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import {
  ESTADO_OFERTA_LABEL,
  ESTADO_OFERTA_TONE,
  ESTADO_CANDIDATO_LABEL,
  ESTADO_CANDIDATO_TONE,
  formatSalary,
} from "@/lib/reclutamiento/labels";
import { CandidatoForm } from "./candidato-form";
import { CandidatoEstadoSelect } from "./candidato-estado-select";

interface Props extends Record<string, unknown> {
  params: Promise<{ id: string }>;
}

async function OfertaDetallePage({ params }: Props) {
  const { id } = await params;
  const oferta = await prismaApp.ofertaTrabajo.findUnique({
    where: { id },
    include: {
      candidatos: { orderBy: { createdAt: "desc" } },
      creador: { select: { nombre: true, apellidos: true } },
    },
  });
  if (!oferta) notFound();

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/admin/reclutamiento"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Briefcase className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              {oferta.titulo}
            </h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_OFERTA_TONE[oferta.estado]}`}>
              {ESTADO_OFERTA_LABEL[oferta.estado]}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-body)]">
            {oferta.departamento && <span>{oferta.departamento}</span>}
            {oferta.ubicacion && <span>· {oferta.ubicacion}</span>}
            {oferta.modalidad && <span>· {oferta.modalidad}</span>}
            {(oferta.salarioMinCents || oferta.salarioMaxCents) && (
              <span>· {formatSalary(oferta.salarioMinCents, oferta.salarioMaxCents)}</span>
            )}
          </div>
        </div>
      </header>

      <div className="rounded-lg border bg-[var(--card)] p-6">
        <h2 className="font-semibold mb-2">Descripción</h2>
        <p className="text-sm text-[var(--text-body)] whitespace-pre-wrap">{oferta.descripcion}</p>
      </div>

      <div className="rounded-lg border bg-[var(--card)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">
            Candidatos · {oferta.candidatos.length}
          </h2>
        </div>

        {oferta.candidatos.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic mb-4">
            Aún no hay candidatos. Añade el primero.
          </p>
        ) : (
          <div className="rounded-lg border overflow-hidden mb-4">
            <table className="w-full">
              <thead className="bg-[var(--muted)] border-b">
                <tr>
                  {["Candidato", "Email", "CV", "Estado", "Recibido"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-body)] px-4 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {oferta.candidatos.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-sm font-medium">
                      {c.nombre} {c.apellidos}
                      {c.telefono && <p className="text-xs text-[var(--text-muted)]">{c.telefono}</p>}
                    </td>
                    <td className="px-4 py-2 text-sm text-[var(--text-body)]">{c.email}</td>
                    <td className="px-4 py-2 text-sm">
                      <div className="flex gap-2">
                        {c.cvUrl && <a className="text-[var(--primary)] hover:underline" href={c.cvUrl} target="_blank" rel="noreferrer">CV</a>}
                        {c.linkedinUrl && <a className="text-[var(--primary)] hover:underline" href={c.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <CandidatoEstadoSelect
                        candidatoId={c.id}
                        estado={c.estado}
                        toneClass={ESTADO_CANDIDATO_TONE[c.estado]}
                        label={ESTADO_CANDIDATO_LABEL[c.estado]}
                      />
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--text-muted)] tabular-nums">
                      {new Date(c.createdAt).toLocaleDateString("es-ES")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="rounded-lg border bg-[var(--muted)]">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-[var(--text-body)]">
            + Añadir candidato
          </summary>
          <div className="p-4 border-t bg-[var(--card)]">
            <CandidatoForm ofertaId={oferta.id} />
          </div>
        </details>
      </div>
    </div>
  );
}

export default withTenantPage<Props>(OfertaDetallePage);

import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { fechaHoraEnZona } from "@/lib/fechas/zona";
import {
  CATEGORIA_LABEL,
  ESTADO_LABEL,
  ESTADO_TONE,
} from "@/lib/denuncias/categorias";
import { plazoAcuseRecibo, plazoResolucion } from "@/lib/denuncias/plazos";
import { DenunciaActions } from "./denuncia-actions";
import { ComentarioForm } from "./comentario-form";

interface Props extends Record<string, unknown> {
  params: Promise<{ id: string }>;
}

async function DenunciaDetallePage({ params }: Props) {
  const { id } = await params;
  // Estas páginas se renderizan en el SERVIDOR, que va en UTC: sin la zona del
  // cliente las horas de los comentarios saldrían dos horas antes de las que
  // marcó el reloj (ticket 3c91f0ab).
  const zonaCliente = (
    await prismaApp.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: { zonaHoraria: true },
    })
  )?.zonaHoraria;
  const denuncia = await prismaApp.denuncia.findUnique({
    where: { id },
    include: {
      comentarios: { orderBy: { createdAt: "asc" } },
      informanteUser: {
        select: { id: true, nombre: true, apellidos: true, email: true },
      },
      asignadoUser: {
        select: { id: true, nombre: true, apellidos: true, email: true },
      },
    },
  });
  if (!denuncia) notFound();

  const empleados = await prismaApp.user.findMany({
    where: { activo: true, rol: { in: ["OWNER", "MANAGER"] } },
    select: { id: true, nombre: true, apellidos: true },
    orderBy: { nombre: "asc" },
  });

  const now = new Date();
  const acuse = denuncia.acuseReciboAt ? null : plazoAcuseRecibo(denuncia.createdAt, now);
  const resolucion = denuncia.resolucionAt ? null : plazoResolucion(denuncia.createdAt, now);

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/admin/canal-denuncias"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al canal
      </Link>

      <header className="flex items-start gap-4 flex-wrap">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            {denuncia.asunto}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_TONE[denuncia.estado]}`}>
              {ESTADO_LABEL[denuncia.estado]}
            </span>
            <span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-body)]">
              {CATEGORIA_LABEL[denuncia.categoria]}
            </span>
            {denuncia.esAnonima && (
              <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                Anónima
              </span>
            )}
          </div>
        </div>
      </header>

      {(acuse || resolucion) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {acuse && (
            <div
              className={`rounded-lg border px-4 py-3 ${
                acuse.level === "danger"
                  ? "border-[var(--danger-bg)] bg-[var(--danger-bg)]"
                  : acuse.level === "warning"
                    ? "border-[var(--warning-bg)] bg-[var(--warning-bg)]"
                    : "border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
                Acuse de recibo
              </p>
              <p
                className={`text-sm font-semibold mt-0.5 ${
                  acuse.level === "danger"
                    ? "text-[var(--danger-text)]"
                    : acuse.level === "warning"
                      ? "text-[var(--warning-text)]"
                      : "text-[var(--color-text-dark,#0F172A)]"
                }`}
              >
                {acuse.label}
              </p>
              <p className="text-xs text-[var(--color-text-muted,#94A3B8)] mt-1">
                Plazo legal: 7 días naturales (Ley 2/2023)
              </p>
            </div>
          )}
          {resolucion && (
            <div
              className={`rounded-lg border px-4 py-3 ${
                resolucion.level === "danger"
                  ? "border-[var(--danger-bg)] bg-[var(--danger-bg)]"
                  : resolucion.level === "warning"
                    ? "border-[var(--warning-bg)] bg-[var(--warning-bg)]"
                    : "border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
                Resolución
              </p>
              <p
                className={`text-sm font-semibold mt-0.5 ${
                  resolucion.level === "danger"
                    ? "text-[var(--danger-text)]"
                    : resolucion.level === "warning"
                      ? "text-[var(--warning-text)]"
                      : "text-[var(--color-text-dark,#0F172A)]"
                }`}
              >
                {resolucion.label}
              </p>
              <p className="text-xs text-[var(--color-text-muted,#94A3B8)] mt-1">
                Plazo legal: 3 meses (Ley 2/2023)
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
            <h2 className="font-semibold text-[var(--color-text-dark,#0F172A)] mb-3">
              Descripción
            </h2>
            <p className="text-sm text-[var(--color-text-body,#475569)] whitespace-pre-wrap">
              {denuncia.descripcion}
            </p>
            {denuncia.fechaIncidente && (
              <p className="mt-4 text-xs text-[var(--color-text-muted,#94A3B8)]">
                Fecha del incidente: {new Date(denuncia.fechaIncidente).toLocaleDateString("es-ES")}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
            <h2 className="font-semibold text-[var(--color-text-dark,#0F172A)] mb-3">
              Comentarios y seguimiento
            </h2>
            {denuncia.comentarios.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted,#94A3B8)] italic">
                Sin comentarios todavía.
              </p>
            ) : (
              <ul className="space-y-3">
                {denuncia.comentarios.map((c) => (
                  <li
                    key={c.id}
                    className={`rounded-lg p-3 ${
                      c.esInterno
                        ? "bg-[var(--warning-bg)] border border-[var(--warning-bg)]"
                        : "bg-[var(--bg-subtle,#F8FAFC)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted,#94A3B8)] mb-1">
                      <span className="font-medium capitalize">{c.autorRole}</span>
                      <span>·</span>
                      <span>{fechaHoraEnZona(c.createdAt, zonaCliente)}</span>
                      {c.esInterno && (
                        <span className="ml-auto rounded-full bg-amber-200 px-2 py-0.5 text-[var(--warning-text)]">
                          Interno
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--color-text-dark,#0F172A)] whitespace-pre-wrap">
                      {c.contenido}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <ComentarioForm denunciaId={denuncia.id} />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
              Informante
            </h3>
            <div className="mt-2 text-sm">
              {denuncia.esAnonima ? (
                <p className="italic text-[var(--color-text-muted,#94A3B8)]">Anónimo</p>
              ) : denuncia.informanteUser ? (
                <>
                  <p className="font-medium text-[var(--color-text-dark,#0F172A)]">
                    {denuncia.informanteUser.nombre} {denuncia.informanteUser.apellidos}
                  </p>
                  <p className="text-xs text-[var(--color-text-body,#475569)] mt-0.5">
                    {denuncia.informanteUser.email}
                  </p>
                </>
              ) : (
                <>
                  {denuncia.informanteNombre && (
                    <p className="font-medium text-[var(--color-text-dark,#0F172A)]">
                      {denuncia.informanteNombre}
                    </p>
                  )}
                  {denuncia.informanteEmail && (
                    <p className="text-xs text-[var(--color-text-body,#475569)] mt-0.5">
                      {denuncia.informanteEmail}
                    </p>
                  )}
                  {denuncia.informanteTelefono && (
                    <p className="text-xs text-[var(--color-text-body,#475569)]">
                      {denuncia.informanteTelefono}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <DenunciaActions
            denunciaId={denuncia.id}
            estado={denuncia.estado}
            asignadoUserId={denuncia.asignadoUserId}
            empleados={empleados}
          />
        </aside>
      </div>
    </div>
  );
}

export default withTenantPage<Props>(DenunciaDetallePage);

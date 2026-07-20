import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Pen, ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { FirmarForm } from "./firmar-form";
import { AbrirDocumentoLink } from "./abrir-documento-link";
import { DescargarFirmadoButton } from "./descargar-firmado";

interface Props extends Record<string, unknown> {
  params: Promise<{ id: string }>;
}

async function FirmaDetallePage({ params }: Props) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");
  const { id } = await params;

  const [solicitud, yo] = await Promise.all([
    prismaApp.solicitudFirma.findUnique({
      where: { id },
      include: {
        documento: { select: { id: true, nombre: true, url: true } },
        solicitadaPor: { select: { nombre: true, apellidos: true } },
        firma: { select: { firmadoEn: true, ip: true, documentoFirmadoUrl: true } },
      },
    }),
    prismaApp.user.findUnique({
      where: { id: userId },
      select: { nombre: true, apellidos: true },
    }),
  ]);
  if (!solicitud) notFound();
  if (solicitud.destinatarioId !== userId) notFound();

  const nombrePorDefecto = `${yo?.nombre ?? ""} ${yo?.apellidos ?? ""}`.trim();

  const expirada =
    solicitud.expiraEn && solicitud.expiraEn < new Date()
      ? true
      : false;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/empleado/firmas"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a mis firmas
      </Link>

      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Pen className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            {solicitud.documento.nombre}
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Enviado por {solicitud.solicitadaPor.nombre} {solicitud.solicitadaPor.apellidos} ·{" "}
            {new Date(solicitud.createdAt).toLocaleDateString("es-ES")}
          </p>
        </div>
      </header>

      {solicitud.mensaje && (
        <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-700 italic">
          &ldquo;{solicitud.mensaje}&rdquo;
        </div>
      )}

      <div className="rounded-lg border bg-white p-6">
        <div className="flex items-center gap-3 mb-3">
          <FileText className="h-5 w-5 text-slate-600" />
          <p className="font-medium">Documento a firmar</p>
        </div>
        {solicitud.documento.url ? (
          <AbrirDocumentoLink url={solicitud.documento.url} />
        ) : (
          <p className="text-sm text-slate-500">
            El documento no tiene URL adjunta. Pide a tu administrador que lo
            adjunte antes de firmar.
          </p>
        )}
      </div>

      {solicitud.estado === "firmada" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-700" />
            <div>
              <p className="font-semibold text-emerald-900">Documento firmado</p>
              <p className="text-sm text-emerald-800 mt-0.5">
                Firmado el{" "}
                {solicitud.firma?.firmadoEn
                  ? new Date(solicitud.firma.firmadoEn).toLocaleString("es-ES")
                  : "—"}
                {solicitud.firma?.ip ? ` · IP ${solicitud.firma.ip}` : ""}
              </p>
            </div>
          </div>
          {solicitud.firma?.documentoFirmadoUrl && (
            <div className="mt-4 border-t border-emerald-200 pt-3">
              <DescargarFirmadoButton
                url={solicitud.firma.documentoFirmadoUrl}
                nombre={solicitud.documento.nombre}
              />
            </div>
          )}
        </div>
      ) : expirada ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-900">La solicitud ha expirado</p>
          <p className="text-sm text-red-800 mt-1">
            Pide a tu administrador que reenvíe la solicitud para firmar.
          </p>
        </div>
      ) : solicitud.estado === "pendiente" ? (
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-slate-700 mb-4">
            Para firmar, teclea tu nombre y DNI/NIE y dibuja tu firma. Se
            estampará en el margen izquierdo de cada hoja del documento y se
            registrará con sello de tiempo, hash SHA-256, tu dirección IP y tu
            navegador. Esta firma tiene validez probatoria.
          </p>
          <FirmarForm solicitudId={solicitud.id} nombrePorDefecto={nombrePorDefecto} />
        </div>
      ) : (
        <div className="rounded-lg border bg-slate-50 p-5 text-sm text-slate-600">
          Esta solicitud está {solicitud.estado}.
        </div>
      )}
    </div>
  );
}

export default withTenantPage<Props>(FirmaDetallePage);

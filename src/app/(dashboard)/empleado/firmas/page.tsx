import { redirect } from "next/navigation";
import Link from "next/link";
import { Pen, FileText, CheckCircle2, Clock } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  firmada: "Firmada",
  rechazada: "Rechazada",
  expirada: "Expirada",
};

const ESTADO_TONE: Record<string, string> = {
  pendiente: "bg-amber-50 text-amber-800 ring-amber-200",
  firmada: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rechazada: "bg-red-50 text-red-800 ring-red-200",
  expirada: "bg-slate-100 text-slate-600 ring-slate-200",
};

async function MisFirmasPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const solicitudes = await prismaApp.solicitudFirma.findMany({
    where: { destinatarioId: userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      documento: { select: { id: true, nombre: true } },
      solicitadaPor: { select: { nombre: true, apellidos: true } },
      firma: { select: { firmadoEn: true } },
    },
  });

  const pendientes = solicitudes.filter((s) => s.estado === "pendiente").length;
  const firmadas = solicitudes.filter((s) => s.estado === "firmada").length;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Pen className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Mis firmas
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Documentos que tu empresa te ha enviado para firmar electrónicamente.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-center gap-3">
          <Clock className="h-8 w-8 text-amber-700" />
          <div>
            <p className="text-xs font-medium text-amber-700 uppercase">Pendientes</p>
            <p className="text-2xl font-bold mt-0.5 text-amber-900">{pendientes}</p>
          </div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-700" />
          <div>
            <p className="text-xs font-medium text-emerald-700 uppercase">Firmadas</p>
            <p className="text-2xl font-bold mt-0.5 text-emerald-900">{firmadas}</p>
          </div>
        </div>
      </div>

      {solicitudes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-12 text-center">
          <Pen className="h-10 w-10 mx-auto text-slate-300" />
          <p className="mt-3 text-sm text-[var(--color-text-body,#475569)]">
            No tienes solicitudes de firma pendientes.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {solicitudes.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white p-4 flex flex-wrap items-start gap-4"
            >
              <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <FileText className="h-5 w-5 text-slate-600" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="font-medium text-[var(--color-text-dark,#0F172A)]">
                  {s.documento.nombre}
                </p>
                <p className="text-xs text-[var(--color-text-muted,#94A3B8)] mt-0.5">
                  Enviado por {s.solicitadaPor.nombre} {s.solicitadaPor.apellidos} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString("es-ES")}
                </p>
                {s.mensaje && (
                  <p className="mt-2 text-sm text-[var(--color-text-body,#475569)] italic">
                    &ldquo;{s.mensaje}&rdquo;
                  </p>
                )}
                {s.expiraEn && s.estado === "pendiente" && (
                  <p className="mt-1 text-xs text-amber-700">
                    Expira el {new Date(s.expiraEn).toLocaleDateString("es-ES")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${ESTADO_TONE[s.estado] ?? ""}`}
                >
                  {ESTADO_LABEL[s.estado] ?? s.estado}
                </span>
                {s.estado === "pendiente" ? (
                  <Link
                    href={`/empleado/firmas/${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Revisar y firmar
                  </Link>
                ) : s.firma?.firmadoEn ? (
                  <span className="text-xs text-slate-500 tabular-nums">
                    {new Date(s.firma.firmadoEn).toLocaleDateString("es-ES")}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default withTenantPage(MisFirmasPage);

import { ShieldAlert, Lock, Clock, CheckCircle2 } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { fechaHoraEnZona } from "@/lib/fechas/zona";
import { hashAccessToken } from "@/lib/denuncias/access-token";
import {
  CATEGORIA_LABEL,
  ESTADO_LABEL,
  ESTADO_TONE,
} from "@/lib/denuncias/categorias";
import { plazoAcuseRecibo, plazoResolucion } from "@/lib/denuncias/plazos";
import { ComentarioAnonimoForm } from "./comentario-form";

interface Props extends Record<string, unknown> {
  params: Promise<{ token: string }>;
}

async function DenunciaAnonimaPage({ params }: Props) {
  const { token } = await params;
  const tokenHash = hashAccessToken(token);

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
    where: { accessTokenHash: tokenHash },
    include: {
      comentarios: {
        where: { esInterno: false },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!denuncia) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="max-w-md w-full rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <Lock className="h-10 w-10 mx-auto text-red-600" />
          <h1 className="mt-3 font-semibold text-red-900">Token inválido</h1>
          <p className="mt-2 text-sm text-red-800">
            El código de acceso no corresponde a ninguna denuncia o es
            incorrecto. Verifica que lo has copiado bien.
          </p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const acuse = denuncia.acuseReciboAt
    ? null
    : plazoAcuseRecibo(denuncia.createdAt, now);
  const resolucion = denuncia.resolucionAt
    ? null
    : plazoResolucion(denuncia.createdAt, now);

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-start gap-3">
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <ShieldAlert className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              {denuncia.asunto}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_TONE[denuncia.estado]}`}
              >
                {ESTADO_LABEL[denuncia.estado]}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
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

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Esta es una vista de seguimiento accesible solo con tu código.
            Guárdalo bien — si lo pierdes no podrás volver a acceder.
          </span>
        </div>

        {(acuse || resolucion) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {acuse && (
              <div className="rounded-lg border bg-white p-4 flex items-center gap-3">
                <Clock className="h-6 w-6 text-amber-700" />
                <div>
                  <p className="text-xs uppercase text-slate-500">Acuse de recibo</p>
                  <p className="font-semibold">{acuse.label}</p>
                </div>
              </div>
            )}
            {resolucion && (
              <div className="rounded-lg border bg-white p-4 flex items-center gap-3">
                <Clock className="h-6 w-6 text-amber-700" />
                <div>
                  <p className="text-xs uppercase text-slate-500">Resolución</p>
                  <p className="font-semibold">{resolucion.label}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {denuncia.estado === "resuelta" && denuncia.resolucionResumen && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              <p className="font-semibold text-emerald-900">Resolución</p>
            </div>
            <p className="text-sm text-emerald-800 whitespace-pre-wrap">
              {denuncia.resolucionResumen}
            </p>
          </div>
        )}

        <div className="rounded-lg border bg-white p-6">
          <h2 className="font-semibold mb-3">Tu denuncia</h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {denuncia.descripcion}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Recibida el {new Date(denuncia.createdAt).toLocaleDateString("es-ES")}
          </p>
        </div>

        <div className="rounded-lg border bg-white p-6">
          <h2 className="font-semibold mb-3">Comentarios y seguimiento</h2>
          {denuncia.comentarios.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              Aún no hay comentarios públicos. Cuando el comité te responda,
              aparecerán aquí.
            </p>
          ) : (
            <ul className="space-y-3 mb-4">
              {denuncia.comentarios.map((c) => (
                <li
                  key={c.id}
                  className={`rounded-lg p-3 ${
                    c.autorRole === "informante"
                      ? "bg-[var(--primary)]/5 ml-8"
                      : "bg-slate-50 mr-8"
                  }`}
                >
                  <p className="text-xs text-slate-500 mb-1">
                    <span className="font-medium capitalize">{c.autorRole}</span>{" "}
                    · {fechaHoraEnZona(c.createdAt, zonaCliente)}
                  </p>
                  <p className="text-sm text-slate-900 whitespace-pre-wrap">
                    {c.contenido}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {denuncia.estado !== "archivada" && (
            <ComentarioAnonimoForm token={token} />
          )}
        </div>
      </div>
    </div>
  );
}

export default withTenantPage<Props>(DenunciaAnonimaPage);

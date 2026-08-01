import { ScanFace, ShieldCheck, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { FaceIdManager } from "./face-id-manager";

async function FaceIdEmpleadoPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const template = await prismaApp.faceTemplate.findUnique({
    where: { userId },
    select: {
      id: true,
      createdAt: true,
      consentimientoAt: true,
      algoritmo: true,
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <ScanFace className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Face ID
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Registra tu rostro para fichar de forma rápida y segura.
          </p>
        </div>
      </header>

      {template ? (
        <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-5 space-y-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-[var(--success-text)]" />
            <div className="flex-1">
              <p className="font-semibold text-[var(--success-text)]">Rostro registrado</p>
              <p className="text-sm text-[var(--success-text)]">
                Registrado el{" "}
                {new Date(template.createdAt).toLocaleDateString("es-ES")} ·
                Algoritmo {template.algoritmo}
              </p>
            </div>
          </div>
          <FaceIdManager mode="reset" userId={userId} />
        </div>
      ) : (
        <FaceIdManager mode="enroll" userId={userId} />
      )}

      <div className="rounded-xl border bg-[var(--muted)] p-5 text-sm text-[var(--text-body)] space-y-2">
        <h2 className="font-semibold text-[var(--text-dark)] flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Privacidad y datos biométricos
        </h2>
        <ul className="space-y-1.5 text-xs">
          <li>• El procesamiento se hace en TU navegador. Nunca subimos foto al servidor.</li>
          <li>• Solo se persiste un vector matemático (128 números) cifrado con AES-256-GCM.</li>
          <li>• El vector es irreversible: no se puede reconstruir tu rostro a partir de él.</li>
          <li>• Puedes eliminarlo en cualquier momento desde aquí.</li>
          <li>• Cumple GDPR Art. 9 (datos biométricos): consentimiento explícito al registrar.</li>
        </ul>
      </div>
    </div>
  );
}

export default withTenantPage(FaceIdEmpleadoPage);

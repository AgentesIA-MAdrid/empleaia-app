import { Briefcase, MapPin, Building2, Banknote } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { formatSalary } from "@/lib/reclutamiento/labels";
import { PostularForm } from "./postular-form";

interface Props extends Record<string, unknown> {
  params: Promise<{ id: string }>;
}

async function OfertaPublicaPage({ params }: Props) {
  const { id } = await params;
  const oferta = await prismaApp.ofertaTrabajo.findUnique({
    where: { id },
    select: {
      id: true,
      titulo: true,
      descripcion: true,
      departamento: true,
      ubicacion: true,
      modalidad: true,
      salarioMinCents: true,
      salarioMaxCents: true,
      estado: true,
      fechaCierre: true,
      createdAt: true,
    },
  });

  if (!oferta || oferta.estado !== "abierta") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
        <div className="max-w-md w-full rounded-lg border bg-[var(--card)] p-8 text-center">
          <Briefcase className="h-10 w-10 mx-auto text-[var(--text-muted)]" />
          <h1 className="mt-3 font-semibold text-[var(--text-dark)]">Oferta no disponible</h1>
          <p className="mt-2 text-sm text-[var(--text-body)]">
            Esta oferta no existe o ya no está aceptando candidaturas.
          </p>
        </div>
      </div>
    );
  }

  const config = await prismaApp.configuracionEmpresa.findFirst({
    select: { nombre: true, appNombre: true, logo: true },
  });
  const empresa = config?.nombre ?? config?.appNombre ?? "la empresa";
  const salario = formatSalary(oferta.salarioMinCents, oferta.salarioMaxCents);

  return (
    <div className="min-h-screen bg-[var(--muted)] py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-start gap-4">
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <Briefcase className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              {oferta.titulo}
            </h1>
            <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
              en <strong>{empresa}</strong>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--text-body)]">
              {oferta.departamento && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {oferta.departamento}
                </span>
              )}
              {oferta.ubicacion && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {oferta.ubicacion}
                </span>
              )}
              {oferta.modalidad && (
                <span className="capitalize inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
                  {oferta.modalidad}
                </span>
              )}
              {salario && (
                <span className="inline-flex items-center gap-1">
                  <Banknote className="h-3.5 w-3.5" />
                  {salario}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="rounded-lg border bg-[var(--card)] p-6">
          <h2 className="font-semibold mb-3">Descripción del puesto</h2>
          <p className="text-sm text-[var(--text-body)] whitespace-pre-wrap">
            {oferta.descripcion}
          </p>
          {oferta.fechaCierre && (
            <p className="mt-4 text-xs text-[var(--warning-text)]">
              Cierra el {new Date(oferta.fechaCierre).toLocaleDateString("es-ES")}
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-[var(--card)] p-6">
          <h2 className="font-semibold mb-1">Postular para esta oferta</h2>
          <p className="text-sm text-[var(--text-body)] mb-4">
            Rellena el formulario y nos pondremos en contacto contigo si tu
            perfil encaja.
          </p>
          <PostularForm ofertaId={oferta.id} />
        </div>

        <p className="text-center text-xs text-[var(--text-muted)]">
          {empresa} — proceso gestionado con empleaIA
        </p>
      </div>
    </div>
  );
}

export default withTenantPage<Props>(OfertaPublicaPage);

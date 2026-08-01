import { Network } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { buildOrganigrama, type NodoOrganigrama } from "@/lib/organigrama/build-tree";

async function OrganigramaPage() {
  const empleados = await prismaApp.user.findMany({
    where: { activo: true },
    select: {
      id: true,
      nombre: true,
      apellidos: true,
      email: true,
      rol: true,
      foto: true,
      tiendaId: true,
      managerId: true,
    },
  });
  const arbol = buildOrganigrama(empleados);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Network className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Organigrama
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Jerarquía de mando de tu empresa · {empleados.length} empleados activos
          </p>
        </div>
      </header>

      {arbol.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-[var(--card)] p-12 text-center">
          <Network className="h-10 w-10 mx-auto text-[var(--text-muted)]" />
          <p className="mt-3 text-sm text-[var(--color-text-body,#475569)]">
            Aún no hay empleados activos. Crea empleados desde la sección Empleados.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6 overflow-x-auto">
          <ul className="space-y-3">
            {arbol.map((nodo) => (
              <NodoCard key={nodo.id} nodo={nodo} nivel={0} />
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-[var(--color-text-muted,#94A3B8)]">
        Asigna el responsable de cada empleado desde la ficha del empleado
        (Empleados → editar → campo &quot;Manager&quot;).
      </p>
    </div>
  );
}

function NodoCard({ nodo, nivel }: { nodo: NodoOrganigrama; nivel: number }) {
  return (
    <li>
      <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--bg-subtle,#F8FAFC)] px-4 py-3">
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-sm font-semibold text-[var(--primary)]">
          {nodo.nombre[0]?.toUpperCase()}
          {nodo.apellidos[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-dark,#0F172A)] truncate">
            {nodo.nombre} {nodo.apellidos}
          </p>
          <p className="text-xs text-[var(--color-text-body,#475569)] truncate">
            {nodo.email}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-body)]">
          {nodo.rol}
        </span>
        {nodo.totalSubordinados > 0 && (
          <span className="inline-flex items-center rounded-full bg-[var(--success-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--success-text)]">
            {nodo.totalSubordinados} a cargo
          </span>
        )}
      </div>
      {nodo.hijos.length > 0 && (
        <ul className="mt-2 space-y-2 ml-8 border-l-2 border-[var(--border)] pl-4">
          {nodo.hijos.map((h) => (
            <NodoCard key={h.id} nodo={h} nivel={nivel + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default withTenantPage(OrganigramaPage);

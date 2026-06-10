/**
 * GET /api/chat/contactos
 *
 * Lista de compañeros con los que iniciar un chat. Accesible por
 * CUALQUIER rol (no solo admin) — el chat es transversal. Gateado por la
 * feature `chat`. Respeta el aislamiento multi_empresa.
 *
 * Existe porque el componente de chat no puede usar /api/empleados (que
 * exige OWNER/MANAGER): un EMPLEADO necesita ver a sus compañeros para
 * abrir conversación.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { resolveEmpresaScope } from "@/lib/multi-empresa/scope";

export const GET = withTenant(
  withFeature("chat", async () => {
    try {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { activo: true };
      const scope = await resolveEmpresaScope(session);
      if (scope.empresaId) where.empresaId = scope.empresaId;

      const empleados = await prisma.user.findMany({
        where,
        select: { id: true, nombre: true, apellidos: true, foto: true },
        orderBy: [{ nombre: "asc" }, { apellidos: "asc" }],
      });

      return Response.json({ empleados });
    } catch (error) {
      console.error("GET /api/chat/contactos error:", error);
      return Response.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  }),
);

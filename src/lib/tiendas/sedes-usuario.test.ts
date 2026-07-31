import { describe, it, expect } from "vitest";
import { sedesDelUsuario } from "./sedes-usuario";

/**
 * Doble mínimo del cliente Prisma: solo lo que usa `sedesDelUsuario`.
 * `usuarioSede.findMany` devuelve las asignaciones N:N ya filtradas por sede
 * activa (el where se comprueba aparte) y `tienda.findFirst` resuelve si la
 * sede principal de la ficha sigue activa.
 */
function prismaFake(opts: {
  asignadas: { tiendaId: string; principal: boolean }[];
  activas: string[];
}) {
  const wheres: unknown[] = [];
  return {
    wheres,
    prisma: {
      usuarioSede: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: async (args: any) => {
          wheres.push(args.where);
          return opts.asignadas.filter((a) => opts.activas.includes(a.tiendaId));
        },
      },
      tienda: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: async (args: any) =>
          opts.activas.includes(args.where.id) ? { id: args.where.id } : null,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

describe("sedesDelUsuario", () => {
  it("junta las sedes asignadas con la principal de la ficha", async () => {
    const { prisma } = prismaFake({
      asignadas: [
        { tiendaId: "t2", principal: false },
        { tiendaId: "t3", principal: false },
      ],
      activas: ["t1", "t2", "t3"],
    });
    expect(await sedesDelUsuario(prisma, { userId: "u1", tiendaId: "t1" })).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("no duplica la principal cuando ya está en el N:N", async () => {
    const { prisma } = prismaFake({
      asignadas: [
        { tiendaId: "t1", principal: true },
        { tiendaId: "t2", principal: false },
      ],
      activas: ["t1", "t2"],
    });
    expect(await sedesDelUsuario(prisma, { userId: "u1", tiendaId: "t1" })).toEqual(["t1", "t2"]);
  });

  it("descarta la sede principal si está desactivada", async () => {
    // En producción hay tiendas de mentira ("BAJA", "VACACIONES") que se usan
    // de cajón para el cuadrante: nadie las coordina.
    const { prisma } = prismaFake({
      asignadas: [{ tiendaId: "t2", principal: false }],
      activas: ["t2"],
    });
    expect(await sedesDelUsuario(prisma, { userId: "u1", tiendaId: "baja" })).toEqual(["t2"]);
  });

  it("sin sedes devuelve lista vacía (que NO es 'todas')", async () => {
    const { prisma } = prismaFake({ asignadas: [], activas: [] });
    expect(await sedesDelUsuario(prisma, { userId: "u1", tiendaId: null })).toEqual([]);
  });

  it("solo mira sedes activas en la consulta del N:N", async () => {
    const { prisma, wheres } = prismaFake({ asignadas: [], activas: [] });
    await sedesDelUsuario(prisma, { userId: "u7", tiendaId: null });
    expect(wheres[0]).toEqual({ userId: "u7", tienda: { activa: true } });
  });
});

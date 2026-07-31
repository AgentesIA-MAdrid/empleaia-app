-- 20260731160000_grupos_objetivo
--
-- Tercer ámbito de los objetivos de venta: los grupos de objetivos
-- (ticket ff5ab304). Junto al comercial ("individual") y al punto de venta
-- ("tienda"), el cliente necesita fijar objetivos a agrupaciones suyas —la
-- primera, "TMT"— que no son ni una persona ni una tienda sueltas.
--
--   GrupoObjetivo ......... el grupo, con el nombre que le pone el cliente
--   GrupoObjetivoMiembro .. quién suma en él: comerciales y/o sedes
--   ObjetivoVenta.grupo_id  objetivo dirigido a un grupo
--
-- Los grupos no se cablean en el código: "TMT" es una fila de GrupoObjetivo,
-- así que el cliente puede crear los que necesite sin tocar la aplicación.
--
-- La clave única de ObjetivoVenta pasa a incluir `grupo_id`, que ya es parte
-- de la combinación que identifica un objetivo. Como en Postgres dos NULL no
-- son iguales, la unique no dedupe por sí sola (el handler sigue haciendo
-- findFirst + create dentro de una transacción); el índice se mantiene
-- alineado con el schema para que `prisma migrate diff` no vea deriva.
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrupoObjetivo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrupoObjetivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrupoObjetivoMiembro" (
    "id" TEXT NOT NULL,
    "grupo_id" TEXT NOT NULL,
    "user_id" TEXT,
    "tienda_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrupoObjetivoMiembro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrupoObjetivo_nombre_key" ON "GrupoObjetivo"("nombre");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrupoObjetivo_activo_orden_idx" ON "GrupoObjetivo"("activo", "orden");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrupoObjetivoMiembro_grupo_id_idx" ON "GrupoObjetivoMiembro"("grupo_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrupoObjetivoMiembro_grupo_id_user_id_key"
  ON "GrupoObjetivoMiembro"("grupo_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrupoObjetivoMiembro_grupo_id_tienda_id_key"
  ON "GrupoObjetivoMiembro"("grupo_id", "tienda_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "GrupoObjetivoMiembro" ADD CONSTRAINT "GrupoObjetivoMiembro_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "GrupoObjetivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "GrupoObjetivoMiembro" ADD CONSTRAINT "GrupoObjetivoMiembro_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "GrupoObjetivoMiembro" ADD CONSTRAINT "GrupoObjetivoMiembro_tienda_id_fkey" FOREIGN KEY ("tienda_id") REFERENCES "Tienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "ObjetivoVenta" ADD COLUMN IF NOT EXISTS "grupo_id" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ObjetivoVenta" ADD CONSTRAINT "ObjetivoVenta_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "GrupoObjetivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- DropIndex / CreateIndex
DROP INDEX IF EXISTS "ObjetivoVenta_mes_userId_tiendaId_articuloId_categoria_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ObjetivoVenta_mes_userId_tiendaId_grupo_id_articuloId_categ_key"
  ON "ObjetivoVenta"("mes", "userId", "tiendaId", "grupo_id", "articuloId", "categoria");

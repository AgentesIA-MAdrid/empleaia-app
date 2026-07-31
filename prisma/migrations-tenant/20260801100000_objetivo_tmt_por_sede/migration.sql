-- 20260801100000_objetivo_tmt_por_sede
--
-- Segundo juego de objetivos por punto de venta: el que impone el operador
-- ("TMT"), aparte del que fija la empresa (ticket 5d8b21c7).
--
-- Son dos cifras sobre la MISMA tienda y las mismas ventas —el operador aprieta
-- con su propia vara—, así que la fuente entra en lo que identifica un objetivo:
-- sin ella, fijar el objetivo TMT de una tienda pisaría el propio.
--
-- Los objetivos que ya hay son todos de la empresa: se quedan en `propio`, que
-- es el valor por omisión de la columna.
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "FuenteObjetivo" AS ENUM ('propio', 'tmt');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "ObjetivoVenta"
  ADD COLUMN IF NOT EXISTS "fuente" "FuenteObjetivo" NOT NULL DEFAULT 'propio';

-- DropIndex / CreateIndex
-- La clave única pasa a incluir `fuente`. Como en Postgres dos NULL no son
-- iguales, la unique no dedupe por sí sola (el handler sigue haciendo findFirst
-- + create dentro de una transacción); el índice se mantiene alineado con el
-- schema para que `prisma migrate diff` no vea deriva.
DROP INDEX IF EXISTS "ObjetivoVenta_mes_destinatario_producto_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ObjetivoVenta_mes_destinatario_producto_key"
  ON "ObjetivoVenta"("mes", "userId", "tiendaId", "grupo_id", "articuloId", "categoria", "subcategoria", "fuente");

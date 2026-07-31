-- 20260731140000_objetivos_por_grupo
--
-- Objetivos de venta sobre un grupo de productos y productos que no cuentan
-- (ticket 714c76dd).
--
--   ObjetivoVenta.categoria ............... objetivo de un grupo del catálogo
--   ArticuloVenta.cuentaParaObjetivos ..... el producto empuja objetivos o no
--
-- El cliente fija objetivos por grupo ("Telefonía", "Servicios"), no solo por
-- producto suelto, y necesita decir qué productos del catálogo cuentan para
-- cumplirlos y cuáles no. El grupo es la categoría que ya tenía el catálogo,
-- así que no se inventa una entidad nueva: un objetivo es de un producto
-- (`articuloId`), de un grupo (`categoria`) o de unidades totales (los dos a
-- null).
--
-- La clave única pasa a incluir `categoria`, que es parte de la combinación que
-- identifica un objetivo. Como en Postgres dos NULL no son iguales, la unique
-- no dedupe por sí sola (el handler sigue haciendo findFirst + create dentro de
-- una transacción); el índice se mantiene alineado con el schema para que
-- `prisma migrate diff` no vea deriva.
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

-- AlterTable
ALTER TABLE "ObjetivoVenta" ADD COLUMN IF NOT EXISTS "categoria" TEXT;

-- AlterTable
ALTER TABLE "ArticuloVenta"
  ADD COLUMN IF NOT EXISTS "cuentaParaObjetivos" BOOLEAN NOT NULL DEFAULT true;

-- DropIndex / CreateIndex
DROP INDEX IF EXISTS "ObjetivoVenta_mes_userId_tiendaId_articuloId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ObjetivoVenta_mes_userId_tiendaId_articuloId_categoria_key"
  ON "ObjetivoVenta"("mes", "userId", "tiendaId", "articuloId", "categoria");

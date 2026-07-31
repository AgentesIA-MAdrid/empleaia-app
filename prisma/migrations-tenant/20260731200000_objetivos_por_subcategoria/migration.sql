-- 20260731200000_objetivos_por_subcategoria
--
-- El grupo de productos sobre el que se fija un objetivo pasa a ser la
-- SUBCATEGORÍA, no la categoría (ticket 234c6b0f).
--
--   ObjetivoVenta.subcategoria ... objetivo de una subcategoría del catálogo
--   ObjetivoVenta.categoria ...... de qué categoría es esa subcategoría
--
-- El cliente lo dijo así: *"las categorías no cuentan como tal para objetivos,
-- pero es un dato que tenemos que recoger para los informes. Necesito la
-- opción de que los objetivos puntúen como subcategoría o como producto
-- individual"*. El comercial sigue registrando producto a producto y la cifra
-- que se compara con el objetivo es la suma de los productos de la
-- subcategoría.
--
-- `categoria` se queda porque la misma subcategoría ("Pospago") puede colgar
-- de dos categorías distintas y son dos grupos distintos —la misma regla que
-- el catálogo, donde el mismo nombre en otra categoría es otro artículo—. Solo
-- se rellena junto a `subcategoria`.
--
-- Los objetivos por categoría que hubiera se borran: ya no hay pantalla que
-- los fije ni cifra con la que compararlos, y dejarlos sería contar unidades
-- para un objetivo que nadie puede ver. El cliente lo autorizó expresamente
-- ("si hay cifras insertadas, elimínalas, no me importa"). No se convierten a
-- subcategoría porque una categoría no es ninguna de sus subcategorías: el
-- objetivo hay que volver a fijarlo con el nivel que toque.
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>): el DELETE
-- solo puede encontrar filas la primera vez, porque a partir de ahí la
-- aplicación no vuelve a escribir `categoria` sin `subcategoria`.

-- AlterTable
ALTER TABLE "ObjetivoVenta" ADD COLUMN IF NOT EXISTS "subcategoria" TEXT;

-- Objetivos de categoría: fuera (ver arriba).
DELETE FROM "ObjetivoVenta" WHERE "categoria" IS NOT NULL AND "subcategoria" IS NULL;

-- DropIndex / CreateIndex
-- La clave única pasa a incluir `subcategoria`, que ya es parte de la
-- combinación que identifica un objetivo. Como en Postgres dos NULL no son
-- iguales, la unique no dedupe por sí sola (el handler sigue haciendo
-- findFirst + create dentro de una transacción); el índice se mantiene
-- alineado con el schema para que `prisma migrate diff` no vea deriva.
DROP INDEX IF EXISTS "ObjetivoVenta_mes_userId_tiendaId_grupo_id_articuloId_categ_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ObjetivoVenta_mes_destinatario_producto_key"
  ON "ObjetivoVenta"("mes", "userId", "tiendaId", "grupo_id", "articuloId", "categoria", "subcategoria");

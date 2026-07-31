-- 20260731180000_catalogo_subcategoria
--
-- Segundo nivel de organización del catálogo de ventas (ticket 2d327b98).
--
--   ArticuloVenta.subcategoria ... subgrupo dentro de la categoría
--
-- Los catálogos largos no caben en un solo nivel: "Telefonía" acaba con
-- treinta artículos dentro y el comercial los busca uno a uno. La
-- subcategoría agrupa dentro de la categoría ("Pospago" dentro de
-- "Telefonía") tanto en Configuración como en la tabla del cierre.
--
-- Los objetivos de venta siguen fijándose sobre la categoría: no se toca
-- `ObjetivoVenta`.
--
-- Idempotente: el entrypoint reaplica todas las migraciones de tenant en cada
-- arranque.

-- AlterTable
ALTER TABLE "ArticuloVenta" ADD COLUMN IF NOT EXISTS "subcategoria" TEXT;

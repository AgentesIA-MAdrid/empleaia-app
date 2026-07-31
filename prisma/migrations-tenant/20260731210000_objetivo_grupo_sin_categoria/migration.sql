-- 20260731200000_objetivo_grupo_sin_categoria
--
-- El objetivo de grupo es la SUBCATEGORÍA, sin la categoría (ticket 528694fa).
--
-- La categoría (Particular, Empresa) organiza el catálogo, filtra informes y la
-- usa el comercial al registrar la venta, pero no es un nivel con objetivo: un
-- objetivo de "FFTH" lo empujan los productos de FFTH de todas las categorías.
-- Antes el grupo se identificaba por subcategoría + categoría, y eso partía la
-- parrilla en dos columnas por subcategoría con objetivos separados.
--
-- Los objetivos ya fijados traen la categoría rellena. Se vacía. Si al vaciarla
-- dos filas quedan iguales —el mismo mes, el mismo destinatario y la misma
-- subcategoría, una por categoría—, se **suman** en una sola: si alguien pidió
-- 11 de FFTH Particular y 5 de FFTH Empresa, el objetivo de FFTH es 16.
--
-- `categoria` se queda en la tabla (sin uso) a propósito: vaciar la columna es
-- reversible y borrarla no, y el código ya la ignora al leer.
--
-- Idempotente: la segunda pasada no encuentra nada que vaciar ni que fusionar.

-- 1. Fusionar los que colisionarían al perder la categoría.
WITH grupos AS (
  SELECT
    id,
    SUM(cantidad) OVER w AS total,
    ROW_NUMBER() OVER (w ORDER BY "createdAt", id) AS puesto
  FROM "ObjetivoVenta"
  WHERE subcategoria IS NOT NULL
  WINDOW w AS (PARTITION BY mes, "userId", "tiendaId", "grupo_id", subcategoria)
)
UPDATE "ObjetivoVenta" o
   SET cantidad = g.total
  FROM grupos g
 WHERE o.id = g.id AND g.puesto = 1;

DELETE FROM "ObjetivoVenta" o
 USING (
   SELECT id, ROW_NUMBER() OVER (
            PARTITION BY mes, "userId", "tiendaId", "grupo_id", subcategoria
            ORDER BY "createdAt", id
          ) AS puesto
     FROM "ObjetivoVenta"
    WHERE subcategoria IS NOT NULL
 ) d
 WHERE o.id = d.id AND d.puesto > 1;

-- 2. Vaciar la categoría de los objetivos de grupo.
UPDATE "ObjetivoVenta" SET categoria = NULL
 WHERE subcategoria IS NOT NULL AND categoria IS NOT NULL;

-- 20260801090000_objetivos_solo_por_grupo
--
-- Los objetivos se fijan por GRUPO de productos (la subcategoría), no producto
-- a producto (ticket 528694fa, segunda parte).
--
-- La parrilla nació siendo producto a producto —era la única forma de fijar un
-- objetivo— y los grupos se añadieron encima sin retirar lo anterior, así que
-- convivían los dos niveles: una columna "FFTH" y, detrás, "Fibra General" y
-- "Fibra 1 GB". El cliente fija los objetivos por grupo y las subcategorías se
-- suman para cumplirlo, de modo que las columnas de producto se retiran.
--
-- Lo ya fijado no se pierde: los objetivos de producto se convierten en el
-- objetivo del grupo de ese producto, sumando los del mismo destinatario y mes.
--
--   Ana · Fibra General = 8  ┐
--   Ana · Fibra 1 GB    = 4  ┘ → Ana · FFTH = 12
--
-- Donde YA había un objetivo de grupo, manda ese y los de producto se
-- descartan: la cifra está puesta al nivel que cuenta y sumarle sus productos
-- daría un objetivo que nadie pidió. Es la misma regla que en unidades totales
-- (`objetivoTotalDe`): lo escrito a mano manda sobre la suma.
--
-- Idempotente: al terminar no queda ningún objetivo con `articuloId`, así que
-- la segunda pasada no encuentra nada que convertir.

-- 1. Crear el objetivo de grupo donde no exista, con la suma de sus productos.
INSERT INTO "ObjetivoVenta" (
  id, mes, "userId", "tiendaId", "grupo_id", "articuloId", subcategoria, categoria,
  cantidad, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  o.mes, o."userId", o."tiendaId", o."grupo_id", NULL, a.subcategoria, NULL,
  SUM(o.cantidad), now(), now()
  FROM "ObjetivoVenta" o
  JOIN "ArticuloVenta" a ON a.id = o."articuloId"
 WHERE a.subcategoria IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "ObjetivoVenta" g
      WHERE g.subcategoria = a.subcategoria
        AND g.mes = o.mes
        AND g."userId" IS NOT DISTINCT FROM o."userId"
        AND g."tiendaId" IS NOT DISTINCT FROM o."tiendaId"
        AND g."grupo_id" IS NOT DISTINCT FROM o."grupo_id"
   )
 GROUP BY o.mes, o."userId", o."tiendaId", o."grupo_id", a.subcategoria;

-- 2. Fuera los objetivos de producto: ya están representados por su grupo (o
--    los pisaba un objetivo de grupo puesto a mano).
DELETE FROM "ObjetivoVenta" WHERE "articuloId" IS NOT NULL;

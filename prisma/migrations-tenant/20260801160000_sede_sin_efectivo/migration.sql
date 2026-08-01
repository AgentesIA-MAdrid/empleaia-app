-- 20260801160000_sede_sin_efectivo
--
-- Sedes que venden pero cuyo dinero no es nuestro (ticket 9d4e17c2): un córner
-- en unos grandes almacenes factura él y liquida después. Su cierre de turno es
-- el de siempre en las ventas, pero el paso de caja no pide efectivo ni tarjeta:
-- pide el stock y los tickets de las ventas facturadas, que se cuadran contra la
-- liquidación del tercero. Y queda fuera de arqueos y de conciliación bancaria.
--
-- La otra exención —la oficina— ya tenía su marca (`es_oficina`), que ahora
-- significa además "aquí no se cierra turno ni se firman los puntos de control".
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

ALTER TABLE "Tienda" ADD COLUMN IF NOT EXISTS "sin_efectivo" BOOLEAN NOT NULL DEFAULT false;

-- Día de arqueo por sede (ticket 2c9d84f1).
--
-- El arqueo lo prepara quien cierra la tienda el último día que abre. Se dio por
-- hecho que era el domingo, y solo lo es en las tiendas de centro comercial: las
-- de calle cierran el sábado y el domingo no hay nadie que cuente el dinero.
--
-- Numeración ISO (1 = lunes … 7 = domingo). El default es domingo, que es el
-- comportamiento anterior: ninguna sede cambia de día al aplicar esto.
ALTER TABLE "Tienda" ADD COLUMN IF NOT EXISTS "arqueo_dia_semana" INTEGER NOT NULL DEFAULT 7;

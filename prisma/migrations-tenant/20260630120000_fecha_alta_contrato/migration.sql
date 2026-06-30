-- 20260630120000_fecha_alta_contrato
--
-- User.fechaAltaContrato (DateTime, nullable): fecha de alta del contrato
-- (antigüedad RR.HH.). Se fija manualmente; NO coincide con `createdAt`
-- (alta del registro en la app). Solo la edita el OWNER.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "fecha_alta_contrato" TIMESTAMP(3);

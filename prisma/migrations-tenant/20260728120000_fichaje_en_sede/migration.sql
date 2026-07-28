-- 20260728120000_fichaje_en_sede
--
-- Ticket #61: el cliente exige que solo se pueda fichar en el puesto de
-- trabajo. `Tienda.exigirFichajeEnSede` activa el modo estricto por sede:
-- fuera del radio el fichaje directo se rechaza y el empleado solo puede
-- registrarlo explicando el motivo, lo que crea una SolicitudFichaje
-- PENDIENTE (clase "fuera_sede") que aprueba un OWNER. El registro de
-- jornada nunca se pierde (RD 8/2019), pero queda bajo control del admin.
--
-- Las columnas geo de SolicitudFichaje guardan el intento mientras no hay
-- Fichaje; se copian al fichaje resultante al aprobar. Idempotente.
ALTER TABLE "Tienda"
  ADD COLUMN IF NOT EXISTS "exigirFichajeEnSede" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SolicitudFichaje"
  ADD COLUMN IF NOT EXISTS "latitud" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitud" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "distancia" INTEGER;

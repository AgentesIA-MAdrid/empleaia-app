-- Margen de cortesía del fichaje: 10 minutos (ticket c726acd0).
--
-- El cliente fija el margen en 10 minutos antes de la entrada y 10 después de
-- la salida al retirar el ajuste automático al turno. Se cambia el valor por
-- defecto de la columna y se actualiza a los tenants que seguían con el
-- anterior (15, el default histórico): si alguien lo había ajustado a mano a
-- otra cifra, esa decisión se respeta.
ALTER TABLE "ConfiguracionEmpresa"
  ALTER COLUMN "margen_fichaje_minutos" SET DEFAULT 10;

UPDATE "ConfiguracionEmpresa"
  SET "margen_fichaje_minutos" = 10
  WHERE "margen_fichaje_minutos" = 15;

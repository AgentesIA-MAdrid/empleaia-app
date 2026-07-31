-- 20260731120000_fichaje_en_horario
--
-- Ticket 25c81b6b: el cliente no quiere que se fiche antes ni después del
-- horario del cuadrante. Si alguien lo intenta, la app se lo recuerda y le
-- ofrece pedir que el fichaje se registre ajustado al horario de su turno;
-- lo aprueba un responsable (SolicitudFichaje clase "fuera_horario").
--
-- `exigir_fichaje_en_horario` está OFF por defecto: ningún tenant cambia de
-- comportamiento hasta que su administrador lo active. `margen_fichaje_minutos`
-- son los minutos de cortesía a cada lado del turno (15 por defecto, el mismo
-- criterio que la gracia del aviso de olvido de fichaje).
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "exigir_fichaje_en_horario" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "margen_fichaje_minutos" INTEGER NOT NULL DEFAULT 15;

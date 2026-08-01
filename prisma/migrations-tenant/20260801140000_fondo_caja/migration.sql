-- 20260801140000_fondo_caja
--
-- Fondo de caja de cada sede a una fecha (ticket 7ab2c5d9): el efectivo que se
-- queda en el cajón como punto de partida del día siguiente, que es lo que el
-- comercial cuenta al abrir.
--
-- No es lo mismo que el efectivo de un cierre (lo recaudado en ese turno) ni que
-- el arqueo semanal (lo que se aparta para que lo recojan), así que va en su
-- propia tabla.
--
-- Con histórico por fecha y no un campo en la sede: el cliente arranca cargando
-- el fondo de un día y después la situación de caja del año, y con un solo
-- número se perdería de dónde viene cada saldo.
--
-- `importe` admite NULL y NEGATIVO a propósito: null cuando la caja de esa sede
-- está en incidencia y no hay cifra fiable, y negativo cuando falta dinero (el
-- listado del cliente traía una sede a -4,48 €).
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

CREATE TABLE IF NOT EXISTS "FondoCaja" (
  "id"                 TEXT NOT NULL,
  "tienda_id"          TEXT NOT NULL,
  "fecha"              DATE NOT NULL,
  "importe"            DECIMAL(10,2),
  "incidencia"         TEXT,
  "nota"               TEXT,
  "registrado_por_id"  TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FondoCaja_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FondoCaja_tienda_id_fecha_key" ON "FondoCaja"("tienda_id", "fecha");
CREATE INDEX IF NOT EXISTS "FondoCaja_fecha_idx" ON "FondoCaja"("fecha");

-- Las FK van con DO/EXCEPTION porque ADD CONSTRAINT no admite IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE "FondoCaja"
    ADD CONSTRAINT "FondoCaja_tienda_id_fkey"
    FOREIGN KEY ("tienda_id") REFERENCES "Tienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FondoCaja"
    ADD CONSTRAINT "FondoCaja_registrado_por_id_fkey"
    FOREIGN KEY ("registrado_por_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

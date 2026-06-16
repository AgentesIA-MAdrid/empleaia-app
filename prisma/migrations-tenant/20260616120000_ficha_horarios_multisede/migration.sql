-- 20260616120000_ficha_horarios_multisede
--
-- 1. User: ficha de empleado ampliada (identificación, personal,
--    dirección, contacto, afiliación, retenciones, datos bancarios).
-- 2. HorarioSede: horarios de apertura por sede (N tramos/día).
-- 3. UsuarioSede: pertenencia empleado↔sede (N:N). `tiendaId` sigue
--    siendo la sede principal.
-- 4. Backfill de UsuarioSede desde User.tiendaId.
-- 5. Recálculo de perfil_completado contra el nuevo set obligatorio
--    (personal + dirección + contacto): los empleados existentes a los
--    que les falten campos deberán completarlos en su próximo acceso.

-- ─── 1. Columnas nuevas en User ─────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "tipo_identificacion"             TEXT,
  ADD COLUMN IF NOT EXISTS "tipo_identificacion_secundaria"  TEXT,
  ADD COLUMN IF NOT EXISTS "numero_identificacion_secundaria" TEXT,
  ADD COLUMN IF NOT EXISTS "nacionalidad"                    TEXT,
  ADD COLUMN IF NOT EXISTS "estado_civil"                    TEXT,
  ADD COLUMN IF NOT EXISTS "genero"                          TEXT,
  ADD COLUMN IF NOT EXISTS "compartir_cumpleanos"            BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "domicilio"                       TEXT,
  ADD COLUMN IF NOT EXISTS "codigo_postal"                   TEXT,
  ADD COLUMN IF NOT EXISTS "localidad"                       TEXT,
  ADD COLUMN IF NOT EXISTS "provincia"                       TEXT,
  ADD COLUMN IF NOT EXISTS "pais"                            TEXT DEFAULT 'España',
  ADD COLUMN IF NOT EXISTS "email_empresa"                   TEXT,
  ADD COLUMN IF NOT EXISTS "email_personal"                  TEXT,
  ADD COLUMN IF NOT EXISTS "email_notificaciones"            TEXT,
  ADD COLUMN IF NOT EXISTS "telefono_empresa"                TEXT,
  ADD COLUMN IF NOT EXISTS "telefono_emergencia"             TEXT,
  ADD COLUMN IF NOT EXISTS "contacto_urgencia"               TEXT,
  ADD COLUMN IF NOT EXISTS "teletrabajo"                     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "grupo_cotizacion"                TEXT,
  ADD COLUMN IF NOT EXISTS "categoria_profesional"           TEXT,
  ADD COLUMN IF NOT EXISTS "numero_seguridad_social"         TEXT,
  ADD COLUMN IF NOT EXISTS "codigo_contrato"                 TEXT,
  ADD COLUMN IF NOT EXISTS "numero_hijos"                    INTEGER,
  ADD COLUMN IF NOT EXISTS "porcentaje_discapacidad"         INTEGER,
  ADD COLUMN IF NOT EXISTS "titular_cuenta"                  TEXT,
  ADD COLUMN IF NOT EXISTS "iban"                            TEXT,
  ADD COLUMN IF NOT EXISTS "bic"                             TEXT,
  ADD COLUMN IF NOT EXISTS "entidad_bancaria"                TEXT;

-- ─── 2. HorarioSede ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HorarioSede" (
  "id"            TEXT NOT NULL,
  "tienda_id"     TEXT NOT NULL,
  "dia_semana"    INTEGER NOT NULL,
  "hora_apertura" TEXT NOT NULL,
  "hora_cierre"   TEXT NOT NULL,
  "orden"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HorarioSede_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "HorarioSede"
    ADD CONSTRAINT "HorarioSede_tienda_id_fkey"
    FOREIGN KEY ("tienda_id") REFERENCES "Tienda"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "HorarioSede_tienda_id_idx" ON "HorarioSede"("tienda_id");

-- ─── 3. UsuarioSede (N:N) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UsuarioSede" (
  "id"        TEXT NOT NULL,
  "user_id"   TEXT NOT NULL,
  "tienda_id" TEXT NOT NULL,
  "principal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsuarioSede_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "UsuarioSede"
    ADD CONSTRAINT "UsuarioSede_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UsuarioSede"
    ADD CONSTRAINT "UsuarioSede_tienda_id_fkey"
    FOREIGN KEY ("tienda_id") REFERENCES "Tienda"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UsuarioSede"
    ADD CONSTRAINT "UsuarioSede_user_id_tienda_id_key" UNIQUE ("user_id", "tienda_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "UsuarioSede_user_id_idx" ON "UsuarioSede"("user_id");
CREATE INDEX IF NOT EXISTS "UsuarioSede_tienda_id_idx" ON "UsuarioSede"("tienda_id");

-- ─── 4. Backfill UsuarioSede desde User.tiendaId ────────────────────
INSERT INTO "UsuarioSede" ("id", "user_id", "tienda_id", "principal")
SELECT
  'usede_' || md5("id" || '|' || "tiendaId"),
  "id",
  "tiendaId",
  true
FROM "User"
WHERE "tiendaId" IS NOT NULL
ON CONFLICT ("user_id", "tienda_id") DO NOTHING;

-- ─── 5. Recálculo de perfil_completado (nuevo set obligatorio) ──────
UPDATE "User" SET "perfil_completado" = (
  "tipo_identificacion" IS NOT NULL
  AND "dni" IS NOT NULL
  AND "nacionalidad" IS NOT NULL
  AND "estado_civil" IS NOT NULL
  AND "genero" IS NOT NULL
  AND "fechaNacimiento" IS NOT NULL
  AND "domicilio" IS NOT NULL
  AND "codigo_postal" IS NOT NULL
  AND "localidad" IS NOT NULL
  AND "provincia" IS NOT NULL
  AND "pais" IS NOT NULL
  AND "telefono" IS NOT NULL
  AND "email_personal" IS NOT NULL
);

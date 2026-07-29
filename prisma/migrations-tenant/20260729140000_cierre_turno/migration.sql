-- 20260729140000_cierre_turno
--
-- Módulo "Cierre de turno" (plan Enterprise, feature `cierre_turno`): control
-- diario de ventas y caja, objetivos de venta, arqueos semanales y
-- conciliación con el banco. Entrega 1: solo estructura.
--
--   ArticuloVenta ....... catálogo de lo que se vende (importable desde Excel)
--   CierreTurno ......... un cierre por comercial y día (borrador → completado)
--   CierreTurnoVenta .... cantidades vendidas, con el nombre en copia
--   CierreCaja .......... efectivo y tarjeta; inmutable al confirmarse
--   CierreCajaAdjunto ... Excel de stock y comprobantes del TPV
--   CierreCajaEdicion ... rastro de las correcciones de un administrador
--   ObjetivoVenta ....... objetivo mensual por comercial o sede
--   Arqueo .............. retirada semanal de efectivo y su recogida firmada
--   MovimientoBanco ..... extracto importado para cuadrar el datáfono
--
-- En User: `puede_recoger_efectivo` y `pin_recogida_hash` (bcrypt) para
-- firmar la recogida de un arqueo. El PIN nunca se guarda en claro.
--
-- Idempotente: IF NOT EXISTS en tablas, columnas e índices; las claves
-- ajenas van en bloques que toleran el duplicado, porque el entrypoint
-- reaplica todas las migraciones de tenant en cada arranque.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pin_recogida_hash" TEXT,
ADD COLUMN IF NOT EXISTS "puede_recoger_efectivo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ArticuloVenta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticuloVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CierreTurno" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tiendaId" TEXT,
    "fecha" DATE NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "detalleJornada" TEXT,
    "incidencia" TEXT,
    "completadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CierreTurno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CierreTurnoVenta" (
    "id" TEXT NOT NULL,
    "cierreId" TEXT NOT NULL,
    "articuloId" TEXT,
    "nombreArticulo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CierreTurnoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CierreCaja" (
    "id" TEXT NOT NULL,
    "cierreId" TEXT NOT NULL,
    "tiendaId" TEXT,
    "fecha" DATE NOT NULL,
    "efectivo" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tarjeta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "confirmadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CierreCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CierreCajaAdjunto" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamañoBytes" INTEGER NOT NULL DEFAULT 0,
    "contenido" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CierreCajaAdjunto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CierreCajaEdicion" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAntes" DECIMAL(10,2) NOT NULL,
    "valorDespues" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CierreCajaEdicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObjetivoVenta" (
    "id" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "userId" TEXT,
    "tiendaId" TEXT,
    "articuloId" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjetivoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Arqueo" (
    "id" TEXT NOT NULL,
    "tiendaId" TEXT NOT NULL,
    "semana" TEXT NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "efectivoDeclarado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "efectivoCierres" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "recogidoPorId" TEXT,
    "recogidoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arqueo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MovimientoBanco" (
    "id" TEXT NOT NULL,
    "tiendaId" TEXT,
    "fecha" DATE NOT NULL,
    "importe" DECIMAL(10,2) NOT NULL,
    "concepto" TEXT,
    "referencia" TEXT,
    "importadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoBanco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ArticuloVenta_activo_orden_idx" ON "ArticuloVenta"("activo", "orden");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreTurno_tiendaId_fecha_idx" ON "CierreTurno"("tiendaId", "fecha");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreTurno_estado_idx" ON "CierreTurno"("estado");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CierreTurno_userId_fecha_key" ON "CierreTurno"("userId", "fecha");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreTurnoVenta_articuloId_idx" ON "CierreTurnoVenta"("articuloId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CierreTurnoVenta_cierreId_articuloId_key" ON "CierreTurnoVenta"("cierreId", "articuloId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CierreCaja_cierreId_key" ON "CierreCaja"("cierreId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreCaja_tiendaId_fecha_idx" ON "CierreCaja"("tiendaId", "fecha");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreCajaAdjunto_cajaId_tipo_idx" ON "CierreCajaAdjunto"("cajaId", "tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreCajaEdicion_cajaId_idx" ON "CierreCajaEdicion"("cajaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CierreCajaEdicion_adminId_idx" ON "CierreCajaEdicion"("adminId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObjetivoVenta_mes_idx" ON "ObjetivoVenta"("mes");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ObjetivoVenta_mes_userId_tiendaId_articuloId_key" ON "ObjetivoVenta"("mes", "userId", "tiendaId", "articuloId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Arqueo_estado_idx" ON "Arqueo"("estado");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Arqueo_tiendaId_semana_key" ON "Arqueo"("tiendaId", "semana");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MovimientoBanco_tiendaId_fecha_idx" ON "MovimientoBanco"("tiendaId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MovimientoBanco_referencia_key" ON "MovimientoBanco"("referencia");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreTurno" ADD CONSTRAINT "CierreTurno_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreTurno" ADD CONSTRAINT "CierreTurno_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreTurnoVenta" ADD CONSTRAINT "CierreTurnoVenta_cierreId_fkey" FOREIGN KEY ("cierreId") REFERENCES "CierreTurno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreTurnoVenta" ADD CONSTRAINT "CierreTurnoVenta_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "ArticuloVenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreCaja" ADD CONSTRAINT "CierreCaja_cierreId_fkey" FOREIGN KEY ("cierreId") REFERENCES "CierreTurno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreCajaAdjunto" ADD CONSTRAINT "CierreCajaAdjunto_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CierreCaja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreCajaEdicion" ADD CONSTRAINT "CierreCajaEdicion_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CierreCaja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CierreCajaEdicion" ADD CONSTRAINT "CierreCajaEdicion_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ObjetivoVenta" ADD CONSTRAINT "ObjetivoVenta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ObjetivoVenta" ADD CONSTRAINT "ObjetivoVenta_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ObjetivoVenta" ADD CONSTRAINT "ObjetivoVenta_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "ArticuloVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Arqueo" ADD CONSTRAINT "Arqueo_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Arqueo" ADD CONSTRAINT "Arqueo_recogidoPorId_fkey" FOREIGN KEY ("recogidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MovimientoBanco" ADD CONSTRAINT "MovimientoBanco_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


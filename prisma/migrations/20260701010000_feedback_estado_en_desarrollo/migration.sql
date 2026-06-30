-- Nuevo estado de ticket: en_desarrollo (el equipo lo está implementando).
ALTER TYPE "master"."FeedbackEstado" ADD VALUE IF NOT EXISTS 'en_desarrollo';

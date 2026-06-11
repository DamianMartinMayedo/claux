-- ================================================================
-- MIGRACIÓN 001: Añadir columnas de período de gracia a clients
-- Ejecutar en Supabase → SQL Editor
-- ================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS fecha_fin_gracia DATE,
  ADD COLUMN IF NOT EXISTS motivo_gracia    TEXT,
  ADD COLUMN IF NOT EXISTS notas_gracia     TEXT;

-- Verificar resultado
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name IN ('fecha_fin_gracia', 'motivo_gracia', 'notas_gracia');

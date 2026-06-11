-- ── Ampliar third_parties con campos de contacto y vías de pago estructuradas ─

ALTER TABLE third_parties
  ADD COLUMN IF NOT EXISTS representante          text,
  ADD COLUMN IF NOT EXISTS cargo                  text,
  ADD COLUMN IF NOT EXISTS via_primaria           jsonb,
  ADD COLUMN IF NOT EXISTS via_secundaria         jsonb,
  ADD COLUMN IF NOT EXISTS contrato_url           text,
  ADD COLUMN IF NOT EXISTS num_contrato           text,
  ADD COLUMN IF NOT EXISTS fecha_inicio_contrato  date,
  ADD COLUMN IF NOT EXISTS fecha_fin_contrato     date;

-- Nota: crear manualmente el bucket 'contratos' en Supabase Storage
-- (Storage → New bucket → contratos → privado o público según preferencia)

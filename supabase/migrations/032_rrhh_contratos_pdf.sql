-- ================================================================
-- MIGRACIÓN 032: RRHH · Contratos como documentos del empleado — Fase 5
--
-- Rediseño: los contratos dejan de ser una página propia y pasan a vivir
-- DENTRO de cada empleado (su página de detalle). Son documentos externos:
--   · se adjunta el PDF del contrato (bucket `contratos`),
--   · un empleado puede tener VARIOS contratos a la vez (sin "vigente único"),
--   · NO condicionan la nómina: el salario que usa la nómina vive en el
--     empleado (`empleados.salario_base`). El salario del contrato es informativo.
--
-- Se añaden las columnas del PDF adjunto.
-- ================================================================

alter table public.contratos
  add column if not exists pdf_url    text,
  add column if not exists pdf_nombre text;

notify pgrst, 'reload schema';

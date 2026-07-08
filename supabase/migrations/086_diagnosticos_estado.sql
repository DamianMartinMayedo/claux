-- Estado de seguimiento de cada solicitud de diagnóstico (lead): 'nuevo' al
-- llegar, 'contactado' cuando el equipo ya se puso en contacto.
alter table public.diagnosticos
  add column if not exists estado text not null default 'nuevo';

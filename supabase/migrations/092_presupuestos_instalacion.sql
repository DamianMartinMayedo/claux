-- ================================================================
-- MIGRACIÓN 092: Presupuestos de instalación (calculadora de ventas)
--
-- Registro histórico de cada presupuesto de instalación que un
-- comercial calcula durante/después de la primera llamada con el
-- prospecto. Ver Formulario_Instalacion_Especificacion.md §4.
--
-- El cálculo (horas por fase, coste) es determinista y se hace en
-- código (src/lib/presupuesto/*). Aquí solo se guarda el snapshot
-- resultante + los inputs, para comparar estimado vs real y afinar
-- tarifas/límites con datos reales más adelante.
-- ================================================================

create table if not exists presupuestos_instalacion (
  id                    bigserial     primary key,
  diagnostico_id        bigint        references diagnosticos(id) on delete set null,  -- lead de origen (opcional)
  client_id             text,                                                          -- si ya es cliente (opcional)
  comercial_email       text,
  comercial_nombre      text,
  nombre_negocio        text          not null,
  nombre_responsable    text,
  contacto              text,
  tarifa                text          not null default 'estandar' check (tarifa in ('fundador','estandar')),
  modulos               text[]        not null default '{}',                            -- claves contratadas (modulos_catalogo)
  volumenes             jsonb         not null default '{}'::jsonb,                     -- §1.3 datos de volumen
  formato_datos         text,                                                           -- §1.4
  migracion             jsonb         not null default '{}'::jsonb,                     -- §1.5 (histórico a migrar + horas manuales)
  desglose              jsonb         not null default '{}'::jsonb,                     -- snapshot horas/subtotal por fase
  revisiones            jsonb         not null default '[]'::jsonb,                      -- líneas "Revisar" con su motivo
  horas_total           numeric(10,2) not null default 0,
  coste_instalacion_usd numeric(12,2) not null default 0,
  cuota_mensual_usd     numeric(12,2) not null default 0,                              -- snapshot recurrente (Σ módulos)
  horas_reales          numeric(10,2),                                                  -- se completa al cerrar la instalación
  estado                text          not null default 'guardado' check (estado in ('guardado','instalado')),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

create index if not exists idx_presupuestos_created     on presupuestos_instalacion (created_at desc);
create index if not exists idx_presupuestos_diagnostico on presupuestos_instalacion (diagnostico_id);

-- RLS: patrón de 085 (acceso total a authenticated; la app usa service_role).
alter table public.presupuestos_instalacion enable row level security;
grant select, insert, update, delete on public.presupuestos_instalacion to service_role;
drop policy if exists "admin_full_access" on public.presupuestos_instalacion;
create policy "admin_full_access" on public.presupuestos_instalacion
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';

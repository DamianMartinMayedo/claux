-- ================================================================
-- MIGRACIÓN 039: Reservas y citas · Franjas horarias (Fase 0 · Tanda 1)
--
-- El dueño configura franjas (comida, cena, turnos…) con capacidad
-- limitada por tramo. Las reservas comprueban disponibilidad contra
-- la capacidad de la franja y las reservas ya existentes.
--
-- dias_semana: array de int (1=Lunes … 7=Domingo). NULL = todos.
--
-- Numeración: FRA-XXXXXXXX.
-- ================================================================

create table if not exists reserva_franjas (
  franja_id    text          primary key,                -- FRA-XXXXXXXX
  client_id    text          not null,

  nombre       text          not null,                   -- "Comida 12:00-16:00"
  hora_inicio  time,                                     -- NULL = sin hora fija
  hora_fin     time,
  capacidad    int           not null default 1,         -- mesas / personas simultáneas
  dias_semana  int[],                                     -- NULL = todos los días

  activa       boolean       not null default true,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

create index if not exists idx_rf_client  on reserva_franjas (client_id);

alter table public.reserva_franjas enable row level security;
grant select, insert, update, delete on public.reserva_franjas to service_role;

notify pgrst, 'reload schema';

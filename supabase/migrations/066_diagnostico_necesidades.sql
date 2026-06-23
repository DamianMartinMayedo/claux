-- ================================================================
-- MIGRACIÓN 066: Catálogo de "necesidades" del diagnóstico
--
-- El paso "¿Qué necesitas?" del diagnóstico público deja de derivar de
-- modulos_catalogo (lenguaje técnico, 1 opción = 1 módulo). Ahora es una lista
-- CURADA DESDE /admin/diagnostico: cada necesidad se expresa en lenguaje del
-- cliente ("Mejorar mis reservas o citas") y mapea a uno o varios módulos del
-- catálogo. Así el equipo controla qué se ofrece sin tocar código, y una sola
-- necesidad puede cubrir varios módulos.
--
-- La columna modulos_catalogo.mostrar_en_diagnostico (065) ya no la usa el
-- diagnóstico; su único consumidor restante es la grilla de "Módulos" de la
-- landing, así que se renombra a mostrar_en_landing para reflejarlo.
-- ================================================================

-- 1) Renombrar la columna de curación de módulos (su rol ahora es solo landing).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'modulos_catalogo' and column_name = 'mostrar_en_diagnostico'
  ) then
    alter table modulos_catalogo rename column mostrar_en_diagnostico to mostrar_en_landing;
  end if;
end $$;

-- 2) Catálogo de necesidades (editable desde admin).
create table if not exists diagnostico_necesidades (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique,
  etiqueta    text not null,                         -- lenguaje del cliente
  descripcion text,                                  -- ayuda corta (opcional)
  icono       text,                                  -- clave de icono (mapa en código, con fallback)
  modulos     jsonb not null default '[]'::jsonb,    -- claves de modulos_catalogo recomendadas
  orden       int  not null default 0,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Misma política que el resto del catálogo: RLS activo, acceso solo vía
-- service_role (loader público) o sesión admin (createClient en el servidor).
alter table diagnostico_necesidades enable row level security;

-- 3) Semilla inicial: lenguaje humano → módulos reales del catálogo.
insert into diagnostico_necesidades (clave, etiqueta, descripcion, icono, modulos, orden) values
  ('inventario', 'Controlar mi inventario y compras',  'Saber qué tengo, qué se agota y cuánto gasto en compras.',                'inventario', '["inventario"]'::jsonb,              1),
  ('reservas',   'Mejorar mis reservas o citas',       'Que tus clientes reserven mesa o pidan cita online, sin llamadas ni libreta.', 'reservas', '["reservas_citas","agenda"]'::jsonb, 2),
  ('catalogo',   'Mostrar mi catálogo o menú con un QR','Una carta o catálogo digital que el cliente abre escaneando un código.',  'catalogo',   '["catalogo_qr"]'::jsonb,             3),
  ('empleados',  'Gestionar mis empleados y nómina',   'Turnos, contratos y pagos de tu equipo en un solo sitio.',                'empleados',  '["rrhh"]'::jsonb,                    4),
  ('clientes',   'Atender a mis clientes por chat',     'Un asistente que responde y toma pedidos por Telegram con IA.',           'chat',       '["asistente_ia"]'::jsonb,            5)
on conflict (clave) do nothing;

notify pgrst, 'reload schema';

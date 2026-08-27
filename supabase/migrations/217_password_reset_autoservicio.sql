-- ================================================================
-- MIGRACIÓN 217: recuperar la contraseña del portal sin depender de nosotros
--
-- Hasta ahora, si el dueño de un negocio olvidaba su contraseña, la única
-- salida era que alguien del equipo CLAUX entrara al admin y le regenerara una
-- temporal (`regenerarPasswordCliente`). En Cuba, con la diferencia horaria y
-- los cortes, eso puede significar un día entero sin poder facturar. Este
-- enlace por correo cierra el círculo: el propio usuario se la restablece.
--
-- Decisiones del diseño (van aquí porque explican la forma de la tabla):
--   · Se guarda el HASH del token, nunca el token. Quien lea la tabla —o una
--     copia de seguridad— no puede entrar con lo que ve, igual que pasa con
--     `client_users.password_hash`.
--   · La fila es por EMAIL, no por usuario: el mismo correo puede tener cuenta
--     en varios negocios (`loginCliente` ya contempla ese caso), y quien manda
--     en el buzón manda en todas ellas. La pantalla del enlace le pregunta a
--     cuál de sus cuentas le pone contraseña nueva.
--   · `usado_at` marca el consumo: el enlace sirve UNA vez. Pedir uno nuevo
--     invalida los anteriores del mismo correo (lo hace la acción).
--
-- RLS sin política a propósito: esta tabla no se lee desde ningún panel. Solo
-- la tocan las acciones del portal, con `service_role` (que salta RLS), así que
-- una política abierta a `authenticated` solo serviría para regalar tokens.
-- ================================================================

create table if not exists public.password_resets (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  token_hash text        not null unique,
  expira_at  timestamptz not null,
  usado_at   timestamptz,
  created_at timestamptz not null default now()
);

-- Para el control de frecuencia (cuántas peticiones lleva ese correo hoy) y
-- para invalidar los enlaces vivos al pedir uno nuevo.
create index if not exists idx_password_resets_email on public.password_resets (email, created_at desc);

alter table public.password_resets enable row level security;
grant select, insert, update, delete on public.password_resets to service_role;

-- ── Plantilla del correo ────────────────────────────────────────────
-- Tipo propio, separado de `password_reset` (la contraseña temporal que genera
-- el equipo): las variables son otras —aquí no viaja ninguna contraseña, solo
-- un enlace con caducidad— y el texto que le llega al cliente es distinto.
alter table public.email_plantillas drop constraint if exists email_plantillas_tipo_check;
alter table public.email_plantillas add constraint email_plantillas_tipo_check check (tipo in (
  'diagnostico_cita', 'bienvenida', 'password_reset', 'password_reset_link',
  'respuesta_soporte', 'confirmacion_pago', 'reactivacion', 'recordatorio_pago',
  'fin_prueba', 'suspension', 'periodo_gracia'
));

-- `do nothing`: si alguien ya la editó desde el admin, esta migración no la pisa.
insert into email_plantillas (tipo, asunto, cuerpo) values
(
  'password_reset_link',
  'Restablece tu contraseña de CLAUX',
  'Hola,

Recibimos una solicitud para restablecer la contraseña de {{usuario}}.

Abre este enlace y define tu nueva contraseña: {{link_reset}}

El enlace caduca en {{minutos}} minutos y solo puede usarse una vez.

Si no lo pediste, no tienes que hacer nada: tu contraseña actual sigue funcionando.

El equipo de CLAUX'
)
on conflict (tipo) do nothing;

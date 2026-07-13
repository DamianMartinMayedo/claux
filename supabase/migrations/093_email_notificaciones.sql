-- ================================================================
-- MIGRACIÓN 093: Sistema de correo transaccional (Resend)
--
-- emails_log: auditoría de cada envío + guard de idempotencia para
-- el cron de recordatorios (Fase 2).
--
-- email_plantillas: contenido editable desde el admin (asunto/cuerpo
-- con {{variables}}), sembrada con un texto por defecto por tipo para
-- que el sistema funcione desde el primer día sin que nadie lo toque.
-- El envoltorio de marca (header/footer) vive en código (src/lib/email/
-- layout.ts), no aquí: el admin solo edita el contenido interior.
-- ================================================================

create table if not exists emails_log (
  id           bigserial     primary key,
  client_id    text          references clients(client_id) on delete set null,
  destinatario text          not null,
  tipo         text          not null,
  estado       text          not null check (estado in ('enviado','fallido')),
  resend_id    text,
  error        text,
  meta         jsonb         not null default '{}'::jsonb,
  created_at   timestamptz   not null default now()
);

create index if not exists idx_emails_log_created  on emails_log (created_at desc);
create index if not exists idx_emails_log_tipo      on emails_log (tipo);
create index if not exists idx_emails_log_client    on emails_log (client_id);

alter table public.emails_log enable row level security;
grant select, insert, update, delete on public.emails_log to service_role;
drop policy if exists "admin_full_access" on public.emails_log;
create policy "admin_full_access" on public.emails_log
  for all to authenticated using (true) with check (true);

create table if not exists email_plantillas (
  tipo       text        primary key check (tipo in (
    'diagnostico_cita', 'bienvenida', 'password_reset', 'respuesta_soporte',
    'confirmacion_pago', 'reactivacion', 'recordatorio_pago', 'fin_prueba', 'suspension'
  )),
  asunto     text        not null,
  cuerpo     text        not null,
  activo     boolean     not null default true,
  updated_at timestamptz not null default now()
);

alter table public.email_plantillas enable row level security;
grant select, insert, update, delete on public.email_plantillas to service_role;
drop policy if exists "admin_full_access" on public.email_plantillas;
create policy "admin_full_access" on public.email_plantillas
  for all to authenticated using (true) with check (true);

insert into email_plantillas (tipo, asunto, cuerpo) values
(
  'diagnostico_cita',
  '¡Gracias por tu diagnóstico, {{nombre}}!',
  'Hola {{nombre}},

Gracias por completar el diagnóstico de CLAUX para tu negocio.

Ya tenemos una idea de lo que necesitas. El siguiente paso es agendar una llamada corta para mostrarte cómo funcionaría CLAUX en tu caso concreto.

Agenda tu cita aquí: {{link_agenda}}

¡Hablamos pronto!
El equipo de CLAUX'
),
(
  'bienvenida',
  'Bienvenido a CLAUX, {{empresa}}',
  'Hola {{nombre}},

Tu cuenta de CLAUX para {{empresa}} ya está lista.

Estos son tus datos de acceso:
Usuario: {{usuario}}
Contraseña temporal: {{password_temporal}}

Entra aquí: {{link_portal}}

Por seguridad, te pediremos definir tu propia contraseña en el primer acceso.

Cualquier duda, aquí estamos.
El equipo de CLAUX'
),
(
  'password_reset',
  'Nueva contraseña para tu cuenta de CLAUX',
  'Hola {{nombre}},

Se generó una nueva contraseña temporal para tu cuenta de CLAUX ({{empresa}}).

Usuario: {{usuario}}
Contraseña temporal: {{password_temporal}}

Entra aquí: {{link_portal}}

Te pediremos definir tu propia contraseña en el próximo acceso.

El equipo de CLAUX'
),
(
  'respuesta_soporte',
  'Respuesta a tu mensaje de soporte',
  'Hola {{nombre}},

Sobre tu mensaje "{{asunto}}":

{{mensaje_admin}}

Si necesitas algo más, responde a este correo.

El equipo de CLAUX'
),
(
  'confirmacion_pago',
  'Confirmamos tu pago — CLAUX',
  'Hola,

Confirmamos la recepción de tu pago de ${{monto}} para {{empresa}}.

Tu suscripción queda activa hasta el {{fecha_expiracion}}.

Gracias por confiar en CLAUX.
El equipo de CLAUX'
),
(
  'reactivacion',
  'Tu cuenta de CLAUX está activa de nuevo',
  'Hola,

Confirmamos tu pago y tu cuenta de {{empresa}} está activa de nuevo.

Ya puedes volver a usar CLAUX con normalidad.

El equipo de CLAUX'
),
(
  'recordatorio_pago',
  'Tu suscripción de CLAUX vence pronto',
  'Hola,

La suscripción de {{empresa}} vence en {{dias}} días (el {{fecha_expiracion}}).

Para evitar interrupciones, realiza el pago antes de esa fecha.

El equipo de CLAUX'
),
(
  'fin_prueba',
  'Tu prueba gratuita de CLAUX está por terminar',
  'Hola,

La prueba gratuita de {{empresa}} termina el {{fecha_expiracion}}.

Si quieres seguir usando CLAUX sin interrupciones, contáctanos para activar tu suscripción.

El equipo de CLAUX'
),
(
  'suspension',
  'Tu cuenta de CLAUX fue suspendida',
  'Hola,

La suscripción de {{empresa}} venció y la cuenta quedó suspendida.

Contáctanos cuando quieras renovar y la reactivamos.

El equipo de CLAUX'
)
on conflict (tipo) do nothing;

notify pgrst, 'reload schema';

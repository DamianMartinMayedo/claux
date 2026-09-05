-- ================================================================
-- MIGRACIÓN 229: propuestas comerciales por lead
--
-- La presentación que Clau enseña en la primera reunión es hoy un
-- PowerPoint que se rellena a mano, y se nota: hay propuestas
-- entregadas con los marcadores de la plantilla dentro («9 X hrs en
-- 2 fases»), con la diapositiva 13 contradiciendo a la 14, y con
-- precios de un modelo comercial retirado en agosto. Esto le da una
-- entidad propia para que los números salgan del sistema.
--
-- POR QUÉ ENTIDAD PROPIA Y NO UN CAMPO DEL LEAD: de los 6
-- presupuestos vivos en producción solo 1 viene de un lead. La
-- propuesta tiene que funcionar con lead, sin lead, y sobre un
-- cliente que ya lo es — los tres vínculos son nulables, igual que en
-- `presupuestos_instalacion`, que nació con el mismo problema.
--
-- NO GUARDA NI UN NÚMERO. Ni precios, ni cuota, ni horas: se leen del
-- presupuesto y del catálogo en cada render. Es lo pedido («que se
-- actualice cuando el presupuesto cambie») y es lo que evita que el
-- documento y la calculadora digan cosas distintas. El dossier sí
-- congela, pero su origen son miles de apuntes que cambian solos;
-- aquí el origen es una fila que solo cambia cuando alguien la toca.
-- ================================================================

create table if not exists propuestas (
  id               bigserial primary key,
  -- Los tres, nulables y a propósito (ver cabecera).
  diagnostico_id   bigint references diagnosticos(id) on delete set null,
  presupuesto_id   bigint references presupuestos_instalacion(id) on delete set null,
  -- Con FK y `cascade`: una propuesta de ampliación muere con su cliente sin que
  -- haya que acordarse de añadirla a `eliminar_cliente()` (memoria «Listas a mano
  -- que derivan»: esa función se queda corta con cada tabla nueva, en silencio).
  client_id        text references clients(client_id) on delete cascade,

  titulo           text not null,
  nombre_negocio   text not null,
  -- Quién la firma. Sale de `admin_users`, no del teclado: en las dos propuestas
  -- reales de agosto el teléfono está tecleado y sale distinto en cada una.
  comercial_email  text,
  comercial_nombre text,
  comercial_tel    text,

  nivel            text not null default 'inicial',   -- qué columna de precios se enseña
  moneda           text not null default 'USD',
  -- Lo que se PRESENTA, que no es lo que se cotiza: el diagnóstico de Fangio pedía
  -- cuatro módulos y su propuesta enseña seis. El presupuesto manda en la
  -- diapositiva del importe; esta lista manda en el relato.
  modulos          text[] not null default '{}',

  estado           text not null default 'BORRADOR',
  token            text unique,                       -- capability URL; null hasta publicar
  -- Clau no oculta secciones: las borra y las mueve. Los números del pie de la
  -- propuesta de AUGE van 1·2·3·4·5·10·6·8·11·12·13·14·15·16.
  secciones_ocultas text[] not null default '{}',
  secciones_orden  text[] not null default '{}',      -- vacío = orden por defecto

  publicada_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint propuestas_estado_chk check (estado in ('BORRADOR', 'PUBLICADA'))
);

create index if not exists idx_propuestas_diagnostico on propuestas (diagnostico_id);
create index if not exists idx_propuestas_presupuesto on propuestas (presupuesto_id);
create index if not exists idx_propuestas_client      on propuestas (client_id);

-- El relato: una fila por bloque editable, mismo patrón que `dossier_secciones`.
-- Claves: entendimos_1..4 | hoy_1..3 | modulo:<clave> | reto | pago | cierre.
create table if not exists propuesta_textos (
  id           bigserial primary key,
  propuesta_id bigint not null references propuestas(id) on delete cascade,
  clave        text not null,
  cuerpo       text,
  orden        int not null default 0,
  unique (propuesta_id, clave)
);

-- Acuse de lectura, copia del patrón de `dossier_aperturas` (mig. 177). Sin PII:
-- interesa cuántas veces y desde qué tipo de aparato, no quién.
create table if not exists propuesta_aperturas (
  id           bigserial primary key,
  propuesta_id bigint not null references propuestas(id) on delete cascade,
  vista_at     timestamptz not null default now(),
  dispositivo  text
);

create index if not exists idx_propuesta_aperturas_prop on propuesta_aperturas (propuesta_id, vista_at desc);

-- Lo que se marca en el configurador. Es el resultado de la reunión y no puede
-- quedarse en el navegador: precarga el presupuesto, se imprime en el PDF y, si
-- se compartió el enlace, dice lo que el cliente tocó por su cuenta. Se guarda al
-- pulsar el botón, no en cada clic: una fila por decisión, no cien por indecisión.
create table if not exists propuesta_selecciones (
  id           bigserial primary key,
  propuesta_id bigint not null references propuestas(id) on delete cascade,
  modulos      text[] not null,
  cuota        numeric(12,2) not null,
  moneda       text not null,
  enviada_at   timestamptz not null default now()
);

create index if not exists idx_propuesta_selecciones_prop on propuesta_selecciones (propuesta_id, enviada_at desc);

-- RLS: patrón del repo. Sin política, en producción la tabla no carga en el admin
-- y en local no se nota (service_role la salta) — memoria «RLS admin en prod».
alter table public.propuestas            enable row level security;
alter table public.propuesta_textos      enable row level security;
alter table public.propuesta_aperturas   enable row level security;
alter table public.propuesta_selecciones enable row level security;

grant select, insert, update, delete on public.propuestas            to service_role;
grant select, insert, update, delete on public.propuesta_textos      to service_role;
grant select, insert, update, delete on public.propuesta_aperturas   to service_role;
grant select, insert, update, delete on public.propuesta_selecciones to service_role;

drop policy if exists "admin_full_access" on public.propuestas;
create policy "admin_full_access" on public.propuestas
  for all to authenticated using (true) with check (true);
drop policy if exists "admin_full_access" on public.propuesta_textos;
create policy "admin_full_access" on public.propuesta_textos
  for all to authenticated using (true) with check (true);
drop policy if exists "admin_full_access" on public.propuesta_aperturas;
create policy "admin_full_access" on public.propuesta_aperturas
  for all to authenticated using (true) with check (true);
drop policy if exists "admin_full_access" on public.propuesta_selecciones;
create policy "admin_full_access" on public.propuesta_selecciones
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';

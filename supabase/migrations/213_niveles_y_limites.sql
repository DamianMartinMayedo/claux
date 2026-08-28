-- ================================================================
-- MIGRACIÓN 213: los tres niveles comerciales y sus límites
--
-- Plan: docs/planes/niveles-comerciales.md
--
-- POR QUÉ. Hasta hoy CLAUX cobraba lo mismo a una tienda con dos cajas que a
-- una cadena con veinte: `clients.tarifa` ('fundador'/'estandar') no son dos
-- productos, son el mismo producto a dos precios. No existía ningún límite de
-- capacidad salvo dos parches vendidos como addons sueltos (Multiempresa y
-- Multidossier). El tamaño del negocio no tocaba la factura por ningún sitio.
--
-- Estas dos tablas son la pieza que faltaba: qué niveles hay y cuánto cabe en
-- cada uno. **Todo se edita desde /admin** — los números de aquí son la semilla
-- inicial, no constantes.
--
-- POR QUÉ TABLA Y NO ENUM/CÓDIGO. El dueño tiene que poder cambiar cualquier
-- límite y el NOMBRE de cada nivel sin desplegar. Las claves ('inicial',
-- 'empresa', 'pro') sí son estables y van con CHECK: el nombre es de cara al
-- cliente y cambia; la clave la usa el código y no puede depender de que nadie
-- se equivoque al teclear (mismo criterio que la mig. 205 con `admin_users.rol`).
--
-- SOBRE `base` NULL. NULL significa **ilimitado**, no «cero» ni «sin definir».
-- Es lo que hace que el nivel Pro no necesite un número mágico grande.
--
-- SOBRE `extra_por_empresa`. El helper de límites calcula
--     base + (empresas_activas - 1) * extra_por_empresa
-- y se siembra a 0 → límite plano, total por cliente. La columna existe para que
-- escalar el límite con el número de empresas sea mañana un cambio de pantalla y
-- no una migración. **Hoy NO se expone en el admin**: se descartó a propósito
-- (cinco de las diez dimensiones no tienen `empresa_id` donde agarrarse, y
-- «100 trabajadores» cabe en una tarjeta de la landing mientras que «50 por
-- empresa, hasta 150» obliga al cliente a echar cuentas). Ficha N3 de
-- docs/planes/mejoras-futuras.md. Si dentro de un año nadie la ha necesitado,
-- se borra: no se conserva «por si acaso».
--
-- RLS: son tablas GLOBALES, no de tenant. Se copia el patrón exacto de
-- `modulos_catalogo` (migs. 084 y 085): SELECT público —la landing y el
-- diagnóstico las leen con la clave anónima— y ALL para `authenticated`, que es
-- el admin. Una tabla con RLS y sin política no devuelve nada, y **solo en
-- producción**: en local el cliente de servicio se la salta.
-- ================================================================

-- ── Los niveles ──────────────────────────────────────────────────
create table if not exists public.niveles (
  clave        text primary key check (clave in ('inicial', 'empresa', 'pro')),
  nombre       text        not null,
  descripcion  text,
  orden        int         not null,
  activo       boolean     not null default true,
  updated_at   timestamptz not null default now()
);

comment on table  public.niveles is
  'Los tres niveles comerciales. La clave es estable y la usa el código; el nombre es de cara '
  'al cliente y se edita desde /admin/niveles.';
comment on column public.niveles.clave is
  'inicial | empresa | pro. NO se renombra nunca: el código compara por esta clave.';

-- ── Los límites de cada nivel ────────────────────────────────────
create table if not exists public.nivel_limites (
  nivel              text not null references public.niveles(clave) on delete cascade,
  dimension          text not null,
  base               int,
  extra_por_empresa  int  not null default 0,
  primary key (nivel, dimension)
);

comment on table  public.nivel_limites is
  'Cuánto cabe en cada nivel, por dimensión. Todo editable desde /admin/niveles.';
comment on column public.nivel_limites.base is
  'NULL = ILIMITADO. No es cero ni «sin definir».';
comment on column public.nivel_limites.extra_por_empresa is
  'Incremento por cada empresa activa más allá de la primera: base + (empresas-1)*extra. '
  'Sembrado a 0 = límite plano por cliente. No se expone en el admin (ficha N3 de mejoras-futuras).';

-- ── Semilla ──────────────────────────────────────────────────────
insert into public.niveles (clave, nombre, descripcion, orden) values
  ('inicial', 'Inicial', 'Para un negocio que empieza o tiene pocos locales.',       1),
  ('empresa', 'Empresa', 'Para un negocio con varios locales y equipo grande.',      2),
  ('pro',     'Pro',     'Sin límites de capacidad y con el asistente siempre activo.', 3)
on conflict (clave) do nothing;

-- Diez dimensiones. NULL = ilimitado.
-- Ojo: `productos` y `servicios` son DOS dimensiones sobre la MISMA tabla
-- (`products`, separadas por `tipo`). Con un solo contador, contratar el módulo
-- Servicios comería el cupo de Inventario, y los módulos son independientes:
-- ninguno puede condicionar la capacidad de otro.
insert into public.nivel_limites (nivel, dimension, base) values
  ('inicial', 'empresas',           3),
  ('inicial', 'puntos_venta',       6),
  ('inicial', 'trabajadores',     100),
  ('inicial', 'productos',        200),
  ('inicial', 'servicios',         50),
  ('inicial', 'almacenes',         10),
  ('inicial', 'cuentas_tesoreria', 10),
  ('inicial', 'usuarios_portal',    5),
  ('inicial', 'dossiers',           3),
  ('inicial', 'ia_conversaciones',500),

  ('empresa', 'empresas',           5),
  ('empresa', 'puntos_venta',      15),
  ('empresa', 'trabajadores',     300),
  ('empresa', 'productos',       1000),
  ('empresa', 'servicios',        200),
  ('empresa', 'almacenes',         20),
  ('empresa', 'cuentas_tesoreria', 20),
  ('empresa', 'usuarios_portal',   10),
  ('empresa', 'dossiers',           5),
  ('empresa', 'ia_conversaciones',1500),

  ('pro',     'empresas',        null),
  ('pro',     'puntos_venta',    null),
  ('pro',     'trabajadores',    null),
  ('pro',     'productos',       null),
  ('pro',     'servicios',       null),
  ('pro',     'almacenes',       null),
  ('pro',     'cuentas_tesoreria', null),
  ('pro',     'usuarios_portal', null),
  ('pro',     'dossiers',        null),
  -- La IA es la ÚNICA dimensión con coste marginal real, así que en Pro tampoco
  -- es infinita: al agotar el cupo cae al modelo gratuito (comportamiento blando
  -- que ya existe en `resolverModelo`). Lo que se promete es «el asistente no se
  -- apaga nunca», no consumo ilimitado del modelo caro.
  ('pro',     'ia_conversaciones', 5000)
on conflict (nivel, dimension) do nothing;

-- ── RLS (patrón de modulos_catalogo, migs. 084 y 085) ────────────
alter table public.niveles       enable row level security;
alter table public.nivel_limites enable row level security;

drop policy if exists "anyone_can_read_niveles" on public.niveles;
create policy "anyone_can_read_niveles" on public.niveles
  for select to public using (true);

drop policy if exists "admin_full_access" on public.niveles;
create policy "admin_full_access" on public.niveles
  for all to authenticated using (true) with check (true);

drop policy if exists "anyone_can_read_nivel_limites" on public.nivel_limites;
create policy "anyone_can_read_nivel_limites" on public.nivel_limites
  for select to public using (true);

drop policy if exists "admin_full_access" on public.nivel_limites;
create policy "admin_full_access" on public.nivel_limites
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';

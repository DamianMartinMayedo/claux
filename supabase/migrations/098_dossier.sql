-- ================================================================
-- MIGRACIÓN 098: Funcionalidad Dossier del negocio
--
-- Convierte los números del negocio en dos documentos para un tercero:
--   · una PRESENTACIÓN para inversores, publicada como enlace web (deck), y
--   · un ESTADO DE RESULTADOS técnico descargable en PDF.
-- Ambos beben del MISMO snapshot congelado: el dueño actualiza una vez y
-- cambian los dos. Funcionalidad INDEPENDIENTE (funciona solo, a mano); si el
-- cliente tiene la base contable, puede TRAER sus números (llenado rápido).
--
-- Fusión no destructiva: dossier_serie.origen es POR FILA (MANUAL|BASE). Traer
-- desde la base nunca pisa una fila MANUAL sin permiso (la resolución vive en
-- código: fusionarSerie + previsualización; esta RPC solo escribe atómicamente
-- el estado ya resuelto).
--
-- Numeración interna: DOS-XXXXXXXX (un dossier).
-- ================================================================

-- ── 1. Cabecera del dossier (1:1 con el snapshot) ────────────────────────────
create table if not exists dossiers (
  dossier_id             text          primary key,                 -- DOS-XXXXXXXX
  client_id              text          not null,
  empresa_id             text,                                      -- null = consolidado (todas)
  titulo                 text          not null default 'Dossier para inversores',
  estado                 text          not null default 'BORRADOR', -- BORRADOR | PUBLICADO
  token                  text          unique,                      -- 32 hex, capability URL; null hasta publicar; revocable
  moneda_presentacion    text          not null,                    -- una sola moneda por dossier
  color_principal        text          not null default '#00AFAA',  -- teal de marca (= --color-primary); propio del dossier
  logo_url               text,                                      -- propio del dossier (no el de la empresa)
  periodo_desde          date,
  periodo_hasta          date,
  crecimiento_mensual_pct numeric(6,2) not null default 0,          -- una sola palanca de proyección
  snapshot_at            timestamptz,                               -- cuándo se congelaron los números
  tasas_usadas           jsonb         not null default '{}',       -- {"CUP":{"tasa":320,"fecha":"2026-07-01"}}
  monedas_faltantes      text[]        not null default '{}',       -- monedas sin tasa (se imprimen como excluidas)
  publicado_at           timestamptz,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now()
);
create index if not exists idx_dossiers_client on dossiers (client_id);
create index if not exists idx_dossiers_token  on dossiers (token);

-- ── 2. Secciones del relato (una fila por sección; reordenable, ocultable) ───
create table if not exists dossier_secciones (
  id            bigint        generated always as identity primary key,
  dossier_id    text          not null,
  client_id     text          not null,
  clave         text          not null,   -- portada|problema|solucion|mercado|traccion|modelo|proyeccion|equipo|cierre
  titulo        text,
  cuerpo        text,
  bullets       jsonb         not null default '[]',
  orden         int           not null default 0,
  visible       boolean       not null default true,
  generado_ia   boolean       not null default false,   -- responde "¿se usó la IA aquí de verdad?"
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (dossier_id, clave)
);
create index if not exists idx_dossier_secciones_dossier on dossier_secciones (dossier_id, orden);

-- ── 3. Serie mensual (12 filas × 3 columnas); origen POR FILA ────────────────
create table if not exists dossier_serie (
  id                bigint        generated always as identity primary key,
  dossier_id        text          not null,
  client_id         text          not null,
  mes               text          not null,                 -- 'YYYY-MM'
  ingresos          numeric(18,2) not null default 0,
  costo_ventas      numeric(18,2) not null default 0,
  gastos_operativos numeric(18,2) not null default 0,
  moneda            text          not null,                 -- ya convertida a moneda_presentacion
  origen            text          not null default 'MANUAL', -- MANUAL | BASE (clave de la fusión no destructiva)
  unique (dossier_id, mes)
);
create index if not exists idx_dossier_serie_dossier on dossier_serie (dossier_id, mes);

-- ── 4. Desglose del período por categoría (grano distinto a la serie) ────────
create table if not exists dossier_lineas (
  id            bigint        generated always as identity primary key,
  dossier_id    text          not null,
  client_id     text          not null,
  grupo         text          not null,   -- INGRESO | COSTO_VENTAS | GASTO_OPERATIVO
  concepto      text          not null,
  monto         numeric(18,2) not null default 0,
  orden         int           not null default 0
);
create index if not exists idx_dossier_lineas_dossier on dossier_lineas (dossier_id, grupo, orden);

-- ── 5. Clasificación coste de ventas — NIVEL CLIENTE, no dossier ─────────────
--   "la harina es coste de ventas" es un hecho del negocio; el 2º dossier lo
--   hereda. El booleano explícito distingue "clasificada como operativo" de
--   "nunca vista" (permite avisar de categorías nuevas sin clasificar).
create table if not exists dossier_costo_ventas (
  id                bigint        generated always as identity primary key,
  client_id         text          not null,
  categoria         text          not null,
  es_costo_ventas   boolean       not null default false,
  updated_at        timestamptz   not null default now(),
  unique (client_id, categoria)
);
create index if not exists idx_dossier_costo_ventas_client on dossier_costo_ventas (client_id);

-- ── 6. Bucket de Storage del logo: REUTILIZAMOS `logos` ──────────────────────
--   El logo del dossier es el mismo tipo de activo que el de la empresa (imagen
--   de marca, lectura pública, escritura por service_role): un bucket aparte solo
--   añadía otro sitio donde mirar. Ruta: logos/<client_id>/dossier-<dossier_id>.webp
--   (prefijo `dossier-` para que no pueda chocar con <client_id>/<empresa_id>.<ext>).
--
--   `logos` se creó A MANO y no estaba en ninguna migración: en una base nueva no
--   existía y subir el logo de una empresa fallaba. Se crea aquí, idempotente, y
--   de paso queda arreglado ese agujero (no solo para el dossier).
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- ── 7. RLS y grants (patrón del repo: RLS on, sin políticas; acceso vía service_role) ──
alter table public.dossiers            enable row level security;
alter table public.dossier_secciones   enable row level security;
alter table public.dossier_serie        enable row level security;
alter table public.dossier_lineas       enable row level security;
alter table public.dossier_costo_ventas enable row level security;

grant select, insert, update, delete on public.dossiers            to service_role;
grant select, insert, update, delete on public.dossier_secciones   to service_role;
grant select, insert, update, delete on public.dossier_serie        to service_role;
grant select, insert, update, delete on public.dossier_lineas       to service_role;
grant select, insert, update, delete on public.dossier_costo_ventas to service_role;

-- ── 8. Semilla del catálogo comercial ────────────────────────────────────────
--   Precio PLACEHOLDER (10/18): el propietario lo ajusta en /admin/modulos.
--   Los precios viven en datos, nunca en código (CONTEXTO §5).
insert into modulos_catalogo
  (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden, paginas) values
  ('dossier', 'Dossier del negocio',
   'Presentación para inversores publicada como enlace web, y estado de resultados descargable en PDF.',
   10, 18, false, 'funcionalidad', 80,
   '[{"ruta":"/portal/dossier","label":"Dossier del negocio","orden":0}]'::jsonb)
on conflict (clave) do nothing;

-- ── 9. RPC: escribir el snapshot atómicamente (delete + insert + update) ─────
--   Supabase-js no tiene transacción. Un delete que borra la serie seguido de un
--   insert que falla dejaría un deck publicado con el gráfico VACÍO mientras el
--   dueño lo enseña. La inteligencia (fusión no destructiva) ya se resolvió en
--   código; esta función solo reemplaza serie+líneas por el estado resuelto y
--   sella la cabecera del snapshot. Todo filtrado por client_id (sin RLS por tenant).
create or replace function dossier_guardar_snapshot(
  p_dossier_id text,
  p_client_id  text,
  p_serie      jsonb,
  p_lineas     jsonb,
  p_tasas      jsonb,
  p_faltantes  text[]
) returns void
language plpgsql as $$
begin
  -- Cerrojo defensivo: el dossier debe existir y ser de este tenant.
  if not exists (
    select 1 from dossiers where dossier_id = p_dossier_id and client_id = p_client_id
  ) then
    raise exception 'DOSSIER_NO_ENCONTRADO';
  end if;

  delete from dossier_serie  where dossier_id = p_dossier_id and client_id = p_client_id;
  delete from dossier_lineas where dossier_id = p_dossier_id and client_id = p_client_id;

  insert into dossier_serie
    (dossier_id, client_id, mes, ingresos, costo_ventas, gastos_operativos, moneda, origen)
  select
    p_dossier_id, p_client_id,
    e->>'mes',
    coalesce((e->>'ingresos')::numeric, 0),
    coalesce((e->>'costo_ventas')::numeric, 0),
    coalesce((e->>'gastos_operativos')::numeric, 0),
    e->>'moneda',
    coalesce(e->>'origen', 'MANUAL')
  from jsonb_array_elements(coalesce(p_serie, '[]'::jsonb)) as e;

  insert into dossier_lineas
    (dossier_id, client_id, grupo, concepto, monto, orden)
  select
    p_dossier_id, p_client_id,
    e->>'grupo',
    e->>'concepto',
    coalesce((e->>'monto')::numeric, 0),
    coalesce((e->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) as e;

  update dossiers set
    tasas_usadas      = coalesce(p_tasas, '{}'::jsonb),
    monedas_faltantes = coalesce(p_faltantes, '{}'::text[]),
    snapshot_at       = now(),
    updated_at        = now()
  where dossier_id = p_dossier_id and client_id = p_client_id;
end; $$;

grant execute on function dossier_guardar_snapshot(text, text, jsonb, jsonb, jsonb, text[]) to service_role;

notify pgrst, 'reload schema';

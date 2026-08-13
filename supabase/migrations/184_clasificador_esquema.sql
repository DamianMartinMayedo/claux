-- 184 · Clasificador de cuentas por defecto · F1.0 — esquema
--
-- Sin lógica: solo las columnas en las que se apoya la RPC de la mig. 185.
-- El plan completo, en docs/planes/clasificador-cuentas-feedback.md.
--
-- La distinción que sostiene todo el clasificador:
--
--   clave_sistema   → «aquí escribe un módulo». Implica es_sistema, y es
--                     IRREVERSIBLE: la fila deja de poder archivarse o borrarse.
--   clave_catalogo  → «esta fila es tal entrada del pack». Identidad para la
--                     semilla y para el anclaje del padre. NO implica es_sistema:
--                     lo sembrado se puede renombrar, archivar y borrar hasta que
--                     un módulo escriba en ello.
--
-- Las dos conviven en la misma fila (una raíz puede ser ancla del pack y a la vez
-- el sitio donde escribe la nómina — la variante C′ del plan §1.12).

alter table public.categorias_gastos
  add column if not exists clave_catalogo text;

comment on column public.categorias_gastos.clave_catalogo is
  'Identidad de esta fila dentro del catálogo por defecto (pack de sector). No implica es_sistema: la fila sigue siendo renombrable, archivable y borrable hasta que un módulo escriba en ella. Distinta de clave_sistema.';

-- Único por cliente, y parcial: las filas hechas a mano no llevan clave y no
-- compiten por el índice. Es el `on conflict` sobre el que se apoya la semilla
-- para ser idempotente sin leer antes.
create unique index if not exists uq_categorias_gastos_clave_catalogo
  on public.categorias_gastos (client_id, clave_catalogo)
  where clave_catalogo is not null;

-- Si el dueño toca la descripción sembrada, deja de ser nuestra: una resiembra o
-- una actualización del pack no puede pisarle el texto.
alter table public.categorias_gastos
  add column if not exists descripcion_editada boolean not null default false;

comment on column public.categorias_gastos.descripcion_editada is
  'true cuando el dueño ha editado la descripción. La semilla no vuelve a escribirla.';

-- Registro de lo sembrado, para distinguir «nunca se sembró» de «se sembró y el
-- dueño la borró». Sin esto la semilla resucitaría lo que él quitó a propósito.
alter table public.clients
  add column if not exists claves_sembradas jsonb not null default '[]'::jsonb;

comment on column public.clients.claves_sembradas is
  'Claves del catálogo ya sembradas a este cliente. Se escribe en la misma transacción que la semilla. Distingue «nunca sembrada» de «el dueño la borró».';

-- ── Retirada de `retenciones_nomina` ─────────────────────────────────────────
--
-- Nadie la escribe desde la mig. 166: la retención no es un gasto de la empresa,
-- es parte del salario devengado que se le retiene al trabajador (la fila DEUDA
-- de la nómina va sin categoría). Quedó una fila de sistema en un cliente que,
-- por ser de sistema, él no puede archivar ni borrar.
--
-- El recuento se comprueba AQUÍ, no se asume: si alguna llegó a usarse, se queda
-- y se avisa. Borrar un gasto de sitio en silencio no es una limpieza.
do $$
declare v_borradas int; v_en_uso int;
begin
  select count(*) into v_en_uso
  from public.categorias_gastos c
  where c.clave_sistema = 'retenciones_nomina'
    and (exists (select 1 from public.gastos_cobros g       where g.categoria_id = c.categoria_id)
      or exists (select 1 from public.movimientos_tesoreria m where m.categoria_id = c.categoria_id)
      or exists (select 1 from public.categorias_gastos h     where h.parent_id    = c.categoria_id));

  delete from public.categorias_gastos c
  where c.clave_sistema = 'retenciones_nomina'
    and not exists (select 1 from public.gastos_cobros g       where g.categoria_id = c.categoria_id)
    and not exists (select 1 from public.movimientos_tesoreria m where m.categoria_id = c.categoria_id)
    and not exists (select 1 from public.categorias_gastos h     where h.parent_id    = c.categoria_id);
  get diagnostics v_borradas = row_count;

  raise notice 'retenciones_nomina · retiradas: % · conservadas por uso: %', v_borradas, v_en_uso;
end $$;

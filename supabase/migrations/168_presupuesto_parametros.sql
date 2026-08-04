-- ─────────────────────────────────────────────────────────────────────────────
-- 168 · Los precios del presupuesto de instalación salen del código
--
-- POR QUÉ. Toda la tarifa vivía en constantes de `src/lib/presupuesto/config.ts`:
-- para cambiar el precio de una hora había que tocar código y desplegar. Y el
-- resultado apenas se movía: las horas dependían SOLO de qué módulos se marcaban,
-- así que teclear 20 productos o 5.000 daba el mismo precio. Sin margen de
-- negociación —ni descuento, ni tarifa por cliente— el comercial solo podía
-- cambiar de tarifa estándar a fundador, un salto de $10/h de golpe.
--
-- QUÉ CAMBIA.
--   1. Una tabla con las líneas presupuestables y sus cuatro números editables.
--      El precio de cada línea escala con el volumen:
--        horas = horas_base + ceil(max(0, volumen − incluido) / tramo) × horas_por_tramo
--      Con eso, migrar cuatro empresas deja de costar lo mismo que migrar una.
--   2. Una sola tarifa/hora (`tarifa_hora_usd`), que sustituye al par
--      fundador/estándar y a la tarifa aparte del histórico. Fundador/estándar
--      se queda donde sí significa algo: el precio de los módulos (cuota mensual).
--   3. Columnas de negociación en el presupuesto: la tarifa aplicada (snapshot,
--      para que uno de hace tres meses siga explicando su número), el descuento
--      y su motivo.
--   4. Fuera `pago_setup_usd_default`: era un importe fijo ($1.000) que solo
--      usaba el alta manual, y que podía contradecir al coste calculado del
--      presupuesto para el mismo cliente. El precio de instalación se decide en
--      un sitio.
--
-- El recargo en dólares por tramo (`EXTRA_TRAMO_USD`, $15) desaparece: mezclar
-- horas × tarifa con un recargo suelto en dólares es lo que hacía el desglose
-- imposible de explicar al cliente. Ahora todo son horas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Líneas presupuestables ────────────────────────────────────────────────
create table if not exists presupuesto_parametros (
  clave            text          primary key,
  -- 1 = configuración inicial (Fase 1) · 2 = migración de datos (Fase 2)
  fase             smallint      not null check (fase in (1, 2)),
  etiqueta         text          not null,
  -- Clave de `modulos_catalogo` que activa la línea. NULL = siempre visible.
  modulo           text,
  -- Horas que cuesta la línea aunque el volumen sea el mínimo.
  horas_base       numeric(6,2)  not null default 0 check (horas_base >= 0),
  -- Volumen que ya cubren las horas base (a partir de aquí se cobran tramos).
  incluido         integer       not null default 0 check (incluido >= 0),
  -- Tamaño del tramo. Nunca 0: es divisor.
  tramo            integer       not null default 1 check (tramo > 0),
  horas_por_tramo  numeric(6,2)  not null default 0 check (horas_por_tramo >= 0),
  orden            smallint      not null default 0,
  activo           boolean       not null default true,
  updated_at       timestamptz   not null default now()
);

comment on table presupuesto_parametros is
  'Líneas del presupuesto de instalación con su coste en horas. Editables en /admin/configuracion → Facturación.';

alter table public.presupuesto_parametros enable row level security;

-- Solo el admin (service_role) las lee y escribe; el portal no las toca.
drop policy if exists presupuesto_parametros_service on public.presupuesto_parametros;
create policy presupuesto_parametros_service on public.presupuesto_parametros
  for all to service_role using (true) with check (true);

-- ── 2. Semilla: los valores que estaban en el código, ya escalados ───────────
-- `horas_base` e `incluido` reproducen lo que se cobraba antes; `tramo` y
-- `horas_por_tramo` son el escalado nuevo. Son un punto de partida: se afinan
-- desde Configuración sin tocar código, que es el objetivo de la migración.
insert into presupuesto_parametros
  (clave, fase, etiqueta, modulo, horas_base, incluido, tramo, horas_por_tramo, orden)
values
  -- Fase 1 · configuración inicial
  ('empresas',            1, 'Empresas a configurar',               null,             1.00,  1,  1, 0.50,  1),
  ('monedas',             1, 'Monedas a gestionar',                 null,             0.50,  3,  3, 0.25,  2),
  ('cuentas_tesoreria',   1, 'Cuentas de tesorería (bancos/cajas)', null,             0.50,  5,  5, 0.25,  3),
  ('turnos_reservas',     1, 'Turnos de reservas',                  'reservas_citas', 0.50,  2,  2, 0.25,  4),
  ('servicios_citas',     1, 'Servicios/especialistas de citas',    'agenda',         0.50,  5,  5, 0.25,  5),
  ('categorias_catalogo', 1, 'Categorías de catálogo/menú',         'catalogo_qr',    0.50, 10, 10, 0.25,  6),
  ('puntos_venta',        1, 'Puntos de venta a crear',             'caja',           0.50,  2,  2, 0.50,  7),
  -- Fase 2 · migración de datos
  ('terceros',            2, 'Contabilidad · Clientes y proveedores', 'base',         2.00, 20, 20, 1.00, 10),
  ('productos_catalogo',  2, 'Catálogo · Productos/servicios',      'catalogo_qr',    2.00, 20, 20, 1.00, 11),
  ('productos_inventario',2, 'Inventario · Productos',              'inventario',     5.00, 50, 50, 2.00, 12),
  ('almacenes',           2, 'Inventario · Almacenes',              'inventario',     1.00,  5,  5, 0.50, 13),
  ('empleados',           2, 'RRHH · Personal',                     'rrhh',           2.00, 20, 20, 1.00, 14),
  ('turnos_trabajo',      2, 'RRHH · Turnos',                       'rrhh',           1.00,  3,  3, 0.50, 15),
  ('config_nomina',       2, 'RRHH · Configuraciones de nómina',    'rrhh',           1.00,  2,  2, 0.50, 16)
on conflict (clave) do nothing;

-- ── 3. Escalares del presupuesto, en `settings` ──────────────────────────────
-- Van aquí y no en la tabla porque no son líneas con volumen: son horas fijas y
-- la tarifa. Mismo sitio que el resto de ajustes de facturación.
insert into settings (key, value) values
  ('tarifa_hora_usd',                    '20'),
  ('presupuesto_horas_alta',             '4'),
  ('presupuesto_horas_formacion_base',   '2'),
  ('presupuesto_horas_formacion_modulo', '1'),
  ('presupuesto_horas_formacion_caja',   '2'),
  ('presupuesto_horas_cierre',           '2')
on conflict (key) do nothing;

-- El importe fijo del alta manual, fuera: dos fuentes para el mismo concepto.
delete from settings where key = 'pago_setup_usd_default';

-- ── 4. Negociación por presupuesto ──────────────────────────────────────────
alter table presupuestos_instalacion
  -- Snapshot de la tarifa aplicada: un presupuesto de hace tres meses tiene que
  -- seguir explicando su propio número cuando suba el precio de la hora.
  add column if not exists tarifa_hora_usd  numeric(10,2) not null default 0,
  add column if not exists descuento_pct    numeric(5,2)  not null default 0
    check (descuento_pct >= 0 and descuento_pct <= 100),
  -- Obligatorio cuando hay descuento (lo valida la acción): sin motivo, dentro de
  -- tres meses nadie sabe por qué ese cliente pagó $700 y no $1.000.
  add column if not exists descuento_motivo text,
  -- Lo que se cobra de verdad = coste_instalacion_usd − descuento.
  add column if not exists total_final_usd  numeric(12,2) not null default 0;

-- Los presupuestos ya guardados conservan su cifra: su total final es el coste
-- que se calculó entonces, y su tarifa la que tuviera su tipo.
update presupuestos_instalacion
   set total_final_usd = coste_instalacion_usd
 where total_final_usd = 0;

update presupuestos_instalacion
   set tarifa_hora_usd = case when tarifa = 'fundador' then 25 else 35 end
 where tarifa_hora_usd = 0;

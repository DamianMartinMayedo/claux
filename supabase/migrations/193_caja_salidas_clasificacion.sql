-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 193 — La bandeja de clasificación de las salidas de gaveta
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cierra la mitad que le faltaba a la Fase 5 del clasificador, y la cierra por
-- un camino distinto al que la especificación proponía. Conviene dejar escrito
-- el porqué, porque el §10.4 del plan pedía otra cosa.
--
-- EL PROBLEMA. El dependiente saca dinero de la gaveta durante el turno (le paga
-- al proveedor, el dueño retira, se lleva la recaudación al banco). La ingesta
-- postea ese movimiento en Tesorería con `origen='CAJA'` —el efectivo baja bien y
-- el arqueo cuadra— pero **no escribe en `gastos_cobros`**, que es de donde se
-- construye el estado de resultados. O sea: el dinero que sale de la gaveta para
-- pagar al proveedor no llega nunca al informe. Es el mismo agujero que la Fase 5
-- acaba de cerrar en el movimiento manual de Tesorería (el C7 del plan), y desde
-- que aquélla se cerró es además una ASIMETRÍA: el mismo pago clasifica si lo
-- tecleas en el portal y desaparece si lo hace el TPV.
--
-- LO QUE NO SE HACE, Y POR QUÉ. El §10.4 quería una lista cerrada de «tipos de
-- operación de caja» que el dependiente eligiera en el móvil. Se descartó:
--
--   · Pone la decisión contable en quien está en el mostrador con cola, que es
--     justo quien no tiene el criterio ni el interés.
--   · Obliga a inventar un vocabulario PARALELO al catálogo de categorías —una
--     segunda verdad— cuando la pregunta que hay que contestar es exactamente la
--     que la Fase 5 ya construyó: «¿en qué se fue este dinero?».
--   · Toca la PWA, su IndexedDB, el payload de sync y el ticket impreso: cinco
--     sitios que sincronizan tarde y son caros de rectificar.
--
-- La decisión es del DUEÑO y se toma después, en el portal, sobre una bandeja de
-- pendientes. El `motivo` de texto libre deja de ser una clasificación fallida y
-- pasa a ser lo que siempre debió ser: la PRUEBA con la que el dueño clasifica.
-- La PWA no se toca en absoluto.
--
-- ── 1. El estado de la clasificación ────────────────────────────────────────
--
-- Hace falta una columna y no basta con derivarlo, por un motivo concreto: la
-- respuesta «esto no es un gasto, solo movió dinero» (el traslado al banco, el
-- sencillo para dar cambio) NO produce ninguna fila en `gastos_cobros`. Sin
-- guardarla, esos movimientos volverían a la bandeja para siempre y el aviso no
-- se apagaría nunca — que es la forma más segura de que el dueño lo ignore.
--
-- `null` = pendiente. Tres estados otra vez, como en `lleva_contador`: «todavía
-- no lo ha mirado» no es lo mismo que «dijo que no es un gasto».
alter table caja_turno_movimientos
  add column if not exists clasificacion   text,
  add column if not exists clasificado_at  timestamptz,
  add column if not exists clasificado_por text;

-- Vocabulario cerrado en CHECK y no en la acción, al revés que la mig. 154: aquí
-- son dos valores que salen de una decisión de negocio ya cerrada, no una lista
-- que vaya a crecer. Si algún día crece, crece con una migración y está bien.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'caja_turno_movimientos_clasificacion_chk') then
    alter table caja_turno_movimientos
      add constraint caja_turno_movimientos_clasificacion_chk
      check (clasificacion is null or clasificacion in ('GASTO', 'SOLO_MUEVE'));
  end if;
end $$;

comment on column caja_turno_movimientos.clasificacion is
  'null = pendiente de clasificar por el dueño · GASTO = generó su fila en gastos_cobros · SOLO_MUEVE = el dueño declaró que aquí el dinero solo cambió de sitio';

-- ── 2. Que no se pueda clasificar dos veces ─────────────────────────────────
--
-- El ancla es `origen_tipo` + `origen_id`, que ya existen: no hace falta columna
-- nueva en `gastos_cobros`. `origen_id` guarda el `movimiento_uuid` generado en el
-- móvil, igual que hace la idempotencia de la ingesta con `referencia_id`.
--
-- El índice es la red de seguridad de verdad, no la comprobación en TypeScript:
-- la bandeja permite acciones en LOTE y el dueño puede tener dos pestañas
-- abiertas con la misma lista cargada. Entre el `select` que comprueba y el
-- `insert` que escribe cabe la otra pestaña, y el resultado sería el gasto
-- duplicado — exactamente lo que esta fase venía a evitar.
--
-- PARCIAL a propósito: `origen_id` lo usan otros orígenes con otra semántica y
-- ahí un único no es cierto.
create unique index if not exists idx_gastos_cobros_caja_mov
  on gastos_cobros (client_id, origen_id)
  where origen_tipo in ('CAJA_SALIDA', 'CAJA_ENTRADA') and origen_id is not null;

-- ── 3. Que contar los pendientes sea barato ─────────────────────────────────
--
-- El conteo no se pide en una pantalla: se pide en TODAS las del módulo (el aviso
-- va en Tesorería, en Gastos, en Reportes y en el dossier antes de publicar), y en
-- cada carga. Parcial sobre los pendientes porque el índice tiene que encoger a
-- medida que el dueño va clasificando, no crecer con el histórico.
create index if not exists idx_caja_movs_sin_clasificar
  on caja_turno_movimientos (client_id, fecha)
  where clasificacion is null;

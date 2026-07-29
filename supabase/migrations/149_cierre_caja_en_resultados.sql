-- ================================================================
-- MIGRACIÓN 149: las ventas del punto de venta entran en el estado de resultados
--
-- Hasta hoy, cerrar la caja posteaba UN ingreso de Tesorería por moneda y nada
-- más. El dinero entraba en la caja, pero la venta no existía para el estado de
-- resultados: `lib/pl/estado.ts` construye el renglón «Ventas» desde `facturas` y
-- desde `gastos_cobros`, y el TPV no escribía en ninguna de las dos. Un negocio
-- que vende solo por mostrador —el caso normal de un restaurante cubano— veía su
-- informe con Ventas en blanco, gastos completos y un resultado negativo enorme.
-- Lo mismo el dossier que se le manda al asesor, el widget del dashboard y el
-- contexto que lee la IA: los cuatro leen `gastos_cobros`.
--
-- La decisión de diseño (que no cambia): en Contabilidad el cierre es UNA fila
-- resumen por moneda, y el detalle ticket a ticket se queda en el módulo Caja. El
-- dueño no quiere cuatrocientas líneas al día en Gastos y cobros.
--
-- El código nuevo (`lib/caja/ingesta.ts`) ya escribe esa fila en cada cierre. Esta
-- migración hace el BACKFILL de lo ya sincronizado, porque sin él el histórico del
-- TPV sigue fuera del informe.
--
-- ⚠️ CONSECUENCIA ASUMIDA (decisión del propietario): los informes de meses
-- PASADOS cambian a propósito — pasan a incluir las ventas de mostrador. Si un
-- cliente ya le mandó un informe a su asesor, las cifras nuevas no cuadrarán con
-- las que mandó. Hay que avisarle.
--
-- ── De dónde sale el importe, y por qué no de `total_por_moneda` ──
-- Del propio movimiento de Tesorería (`origen='CAJA'`), no del `total_por_moneda`
-- de la sesión. Dos razones:
--   1. Si un ticket se anula DESPUÉS del cierre, `total_por_moneda` se recalcula en
--      la siguiente sincronización pero el movimiento de Tesorería NO (limitación
--      conocida y documentada del módulo Caja). Tomando el movimiento, contabilidad
--      y caja dicen lo mismo y el puente devengado↔caja cuadra; tomando el total,
--      el estado de resultados y el flujo se separarían sin que nada lo explique.
--   2. La fecha sale del movimiento tal cual, sin razonar sobre zonas horarias:
--      las dos filas caen en el mismo mes por construcción.
-- Y de paso el JOIN hace de filtro: una moneda sin cuenta mapeada no tiene
-- movimiento, así que tampoco se contabiliza — la misma regla que aplica el código
-- en vivo (los dos efectos van juntos o no van).
--
-- Idempotente por (client_id, origen_tipo, origen_id, moneda) — el índice parcial
-- de la mig. 118 ya cubre esa consulta. El `registro_id` es determinista (md5 del
-- par cierre+moneda) para que reejecutar no invente ids nuevos, y el
-- `on conflict do nothing` cierra el caso improbable de colisión de formato.
-- ================================================================

insert into gastos_cobros (
  registro_id, client_id, empresa_id, tipo, fecha, vencimiento, tercero_id,
  categoria, categoria_id, descripcion, moneda, monto, notas,
  origen_tipo, origen_id, created_at, updated_at
)
select
  'COB-' || upper(substring(md5(m.referencia_id || ':' || m.moneda) for 8)),
  m.client_id,
  s.empresa_id,
  'COBRO',
  m.fecha,
  null,                       -- no hay nada que vencer: ya está cobrado
  null,                       -- el mostrador no tiene cliente
  null,                       -- un COBRO no lleva categoría
  null,
  'Ventas de caja ' || c.nombre || ' — cierre ' || substring(m.referencia_id for 8),
  m.moneda,
  m.monto,
  'Resumen del cierre del punto de venta. El detalle, ticket a ticket, está en Caja.',
  'CIERRE_CAJA',
  m.referencia_id,
  now(),
  now()
from movimientos_tesoreria m
join caja_sesiones s on s.sesion_uuid = m.referencia_id and s.client_id = m.client_id
join cajas         c on c.caja_id     = s.caja_id       and c.client_id = m.client_id
where m.origen = 'CAJA'
  and m.tipo   = 'INGRESO'
  and m.monto  > 0
  and not exists (
    select 1 from gastos_cobros g
     where g.client_id   = m.client_id
       and g.origen_tipo = 'CIERRE_CAJA'
       and g.origen_id   = m.referencia_id
       and g.moneda      = m.moneda
  )
on conflict (registro_id) do nothing;

notify pgrst, 'reload schema';

-- ================================================================
-- MIGRACIÓN 170: Caja — rescate de las ventas que no llegaron a la contabilidad
--
-- El problema que resuelve (plan: docs/planes/caja-correcciones.md, Fase 2):
-- los resúmenes a Tesorería, `gastos_cobros` e Inventario los escribe el CIERRE
-- del turno. Un turno que nadie cierra —se acabó la batería, se fue la luz, el
-- cajero se marchó, el móvil se formateó— deja sus ventas fuera de los libros
-- PARA SIEMPRE: visibles en Operaciones, ausentes del informe, y sin que ninguna
-- pantalla lo diga. La Fase 1 evita que vuelva a pasar (el turno abierto ya sube);
-- esto es lo que permite RECUPERAR lo que ya pasó.
--
-- Por qué una función y no una consulta desde el código: hace falta saber qué
-- tickets NO tienen cierre, y eso es un anti-join. Con PostgREST habría que
-- traerse todos los tickets del cliente al servidor de Next para descartarlos ahí
-- —en un TPV son un ticket por venta—, o acotar por fecha y **esconder dinero
-- viejo**, que es justo el fallo que este plan corrige. Es de solo LECTURA.
--
-- Agrupa por turno y devuelve dos casos:
--   · ABIERTA     — el turno existe y sigue sin cerrar (el caso normal a partir
--                   de ahora, porque la Fase 1 sube la sesión abierta).
--   · SIN_SESION  — hay tickets cuyo turno no llegó nunca (histórico anterior a
--                   la Fase 1). Si además les falta el `sesion_uuid`, se agrupan
--                   por caja y DÍA DEL NEGOCIO con una clave sintética estable,
--                   para que el rescate sea idempotente: `sesion_uuid` es `text`.
--
-- Los ANULADO quedan fuera: se rectificaron, no son dinero pendiente.
-- ================================================================

create or replace function caja_pendientes_contabilizar(
  p_client_id   text,
  p_empresa_ids text[]
) returns table (
  caja_id     text,
  sesion_uuid text,
  motivo      text,
  desde       timestamptz,
  hasta       timestamptz,
  tickets     bigint,
  totales     jsonb
)
language sql
stable
as $$
  with vigentes as (
    select
      t.caja_id,
      -- Clave de agrupación: su turno, o uno sintético por caja y día del negocio.
      -- La zona importa: en Cuba (UTC−4/−5) el corte por UTC parte la noche en dos.
      coalesce(
        t.sesion_uuid,
        'SIN-TURNO-' || t.caja_id || '-' ||
          to_char(t.fecha at time zone 'America/Havana', 'YYYY-MM-DD')
      )                                   as clave,
      t.sesion_uuid                       as sesion_original,
      t.moneda,
      t.total,
      t.fecha,
      s.sesion_uuid                       as ses,
      s.abierta_at
    from caja_tickets t
    left join caja_sesiones s
      on  s.sesion_uuid = t.sesion_uuid
      and s.client_id   = t.client_id
    where t.client_id = p_client_id
      and t.empresa_id = any (p_empresa_ids)
      and coalesce(t.estado, 'VIGENTE') <> 'ANULADO'
      -- Sin fila de turno, o con el turno todavía abierto: en los dos casos su
      -- dinero no ha entrado en ningún sitio.
      and (s.sesion_uuid is null or s.estado = 'ABIERTA')
  ),
  por_moneda as (
    select caja_id, clave, moneda, sum(total) as total
      from vigentes
     group by 1, 2, 3
  )
  select
    v.caja_id,
    v.clave                                                        as sesion_uuid,
    case when bool_or(v.ses is null) then 'SIN_SESION' else 'ABIERTA' end as motivo,
    min(coalesce(v.abierta_at, v.fecha))                           as desde,
    max(v.fecha)                                                   as hasta,
    count(*)::bigint                                               as tickets,
    (select jsonb_object_agg(m.moneda, m.total)
       from por_moneda m
      where m.caja_id = v.caja_id and m.clave = v.clave)           as totales
  from vigentes v
  group by v.caja_id, v.clave
  order by max(v.fecha) desc;
$$;

grant execute on function caja_pendientes_contabilizar(text, text[]) to service_role;

-- ── Adoptar los tickets sueltos de un día ────────────────────────────────────
-- Contrapartida de la clave sintética de arriba: al rescatar un grupo SIN_SESION
-- sin `sesion_uuid`, sus tickets pasan a colgar del turno que se acaba de crear —
-- si no, `postearResumenCierre` no encontraría ninguna venta que sumar.
-- El día se compara en la zona del NEGOCIO, igual que al agrupar; en UTC el corte
-- caería a media noche cubana y partiría la jornada en dos.
-- Idempotente: la clave es estable y solo toca los que aún no tienen turno.
create or replace function caja_adoptar_tickets_sueltos(
  p_client_id   text,
  p_caja_id     text,
  p_dia         text,
  p_sesion_uuid text
) returns integer
language plpgsql
as $$
declare
  v_n integer;
begin
  update caja_tickets
     set sesion_uuid = p_sesion_uuid
   where client_id   = p_client_id
     and caja_id     = p_caja_id
     and sesion_uuid is null
     and to_char(fecha at time zone 'America/Havana', 'YYYY-MM-DD') = p_dia;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

grant execute on function caja_adoptar_tickets_sueltos(text, text, text, text) to service_role;

notify pgrst, 'reload schema';

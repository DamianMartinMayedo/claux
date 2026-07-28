-- ================================================================
-- MIGRACIÓN 140: Nómina · la línea deja de ser un número y pasa a
--                tener MOTIVOS
--
-- PROBLEMA. `nomina_lineas.deducciones` es un número opaco: no se guarda qué
-- conceptos lo formaron. Es la limitación de diseño más consecuente del módulo,
-- y de ella cuelgan tres cosas que hoy no se pueden hacer:
--
--  1. No hay sitio para lo PUNTUAL del mes (una rotura, un descuento de una vez).
--     La única vía es editar la línea a mano, lo que pierde el motivo y lo borra
--     el primer recálculo — que no puede distinguir un ajuste manual de un
--     concepto sin aplicar, así que los pisa todos (de ahí su previsualización).
--  2. No se puede repartir el coste por ACREEDOR de verdad. La mig. 139 separó
--     Salarios de Retenciones ASUMIENDO que toda deducción es un impuesto. Para
--     dejar de asumirlo hay que saber qué es cada importe.
--  3. No hay recibo de nómina ni informe fiscal posibles: no hay qué desglosar.
--
-- MODELO. Una tabla de ÍTEMS por línea. El salario base NO es un ítem: se queda
-- en `nomina_lineas.salario_base`, que ya es la foto congelada del período. Los
-- ítems explican solo lo que se suma o se resta encima:
--
--     devengado   = salario_base + Σ ítems DEVENGO
--     deducciones =                Σ ítems RETENCION
--
-- Es la misma firma que ya tiene `aplicarConceptos(base, conceptos)`, así que el
-- cambio en código es mínimo — y hace que una línea sin bonos ni deducciones no
-- necesite NINGÚN ítem, que es lo que deja el relleno casi en nada (ver abajo).
--
-- `tipo` tiene TRES valores, no dos. El tercero es el hueco que el modelo nunca
-- supo expresar: una obligación que paga la EMPRESA por encima del bruto, que no
-- es deducción (no reduce el neto) ni forma parte del devengado. Sin él, el
-- modelo cubano (IUFT, Contribución a la Seguridad Social) no cabe. No se usa
-- todavía: llega con el motor legal.
--
-- `origen` es lo que hace que el recálculo pueda dejar de pisar lo escrito a
-- mano: PUNTUAL se PRESERVA, todo lo demás se REEMPLAZA.
--
-- ── LA TRAMPA DEL RELLENO (leer antes de tocarlo) ─────────────────────────────
-- Si una línea sin desglose conocido se rellenara con un ítem PUNTUAL por su
-- importe guardado, el recálculo —que preserva los puntuales— sumaría encima los
-- conceptos vigentes y DUPLICARÍA la deducción. Por eso el importe heredado lleva
-- su propio origen, LEGADO, que se comporta como CONCEPTO ante el recálculo (se
-- reemplaza), no como PUNTUAL (se preserva). Así:
--   · migrar no mueve ni una cifra,
--   · y el primer recálculo deja la línea bien desglosada, igual que hoy.
--
-- Medido en producción antes de escribir esto (2026-07-27): 54 líneas en total,
-- 2 clientes. Las 25 CONFIRMADAS tienen deducciones = 0 y devengado =
-- salario_base, así que NO NECESITAN NI UN ÍTEM: el histórico inmutable no se
-- toca en absoluto. De las 29 en BORRADOR, solo 4 llevan deducción. Cero
-- conceptos en modo PORCENTAJE en toda la base.
--
-- ── ÍNDICES ÚNICOS QUE FALTABAN ──────────────────────────────────────────────
-- «Una nómina por empresa y período» se comprobaba SOLO en código con un count
-- antes de insertar, así que dos peticiones simultáneas podían crear duplicados.
-- Tampoco había único en (nomina_id, empleado_id). Verificado que hoy no hay
-- duplicados de ninguno de los dos, así que entran sin conflicto.
--
-- Plan completo: docs/planes/nomina-plan-completo.md
-- ================================================================

-- ── 1. Los ítems de la línea ──────────────────────────────────────────────────
create table if not exists public.nomina_linea_conceptos (
  item_id    text primary key,
  linea_id   text not null,
  nomina_id  text not null,
  client_id  text not null,
  -- SNAPSHOT: el concepto o la regla que lo originó puede renombrarse o morir;
  -- lo que se le retuvo a esta persona en este mes, no.
  nombre     text not null,
  tipo       text not null,
  monto      numeric(18,2) not null default 0,
  origen     text not null,
  -- concepto_id / regla_id / parametro_id. NULL en PUNTUAL y LEGADO.
  origen_id  text,
  -- Solo para RETENCION. TERCERO_FISCAL = se le sigue debiendo a la agencia
  -- tributaria; EMPRESA = salario ya pagado (anticipo), no se le debe a nadie.
  destino    text,
  created_at timestamptz not null default now(),

  constraint nlc_tipo_ck   check (tipo   in ('DEVENGO','RETENCION','APORTE_EMPRESA')),
  constraint nlc_origen_ck check (origen in ('LEY','REGLA','CONCEPTO','INCIDENCIA','PUNTUAL','LEGADO')),
  constraint nlc_destino_ck check (
    destino is null or (tipo = 'RETENCION' and destino in ('TERCERO_FISCAL','EMPRESA'))
  ),

  -- CASCADE a propósito: `eliminarNomina` borra `nomina_lineas` directamente, así
  -- que sin esto cada nómina borrada dejaría sus ítems huérfanos. Es el mismo
  -- mecanismo que ya usan las tablas-hijas del resto del esquema.
  constraint nlc_linea_fk foreign key (linea_id)
    references public.nomina_lineas (linea_id) on delete cascade
);

create index if not exists idx_nlc_linea  on public.nomina_linea_conceptos (linea_id);
create index if not exists idx_nlc_nomina on public.nomina_linea_conceptos (nomina_id);
create index if not exists idx_nlc_client on public.nomina_linea_conceptos (client_id);

-- Sin políticas, como el resto del esquema: no hay RLS operativa y la aplicación
-- accede con service_role filtrando por client_id en cada consulta.
alter table public.nomina_linea_conceptos enable row level security;

-- ── 2. Los dos únicos que faltaban ────────────────────────────────────────────
create unique index if not exists uq_nominas_empresa_periodo
  on public.nominas (client_id, empresa_id, periodo);

create unique index if not exists uq_nomina_lineas_empleado
  on public.nomina_lineas (nomina_id, empleado_id);

-- ── 3. Relleno de lo que ya existe ────────────────────────────────────────────
-- Regla: reconstruir ítems CONCEPTO cuando la cifra guardada cuadre EXACTAMENTE
-- con los conceptos vigentes del trabajador; si no cuadra, un único ítem LEGADO
-- por el importe guardado. Nunca PUNTUAL (ver la trampa arriba).
--
-- Una línea cuyo devengado == salario_base no recibe ítem de DEVENGO aunque el
-- trabajador tenga bonos vigentes: significa que esa línea NO los aplicó (está
-- desfasada), y el sistema ya lo detecta y ofrece actualizarla. Inventarle el
-- bono aquí cambiaría su importe por la espalda.

do $$
declare
  v_insertados int;
begin
  with base as (
    select nl.linea_id, nl.nomina_id, nl.client_id, nl.empleado_id,
           nl.salario_base,
           round(nl.devengado - nl.salario_base, 2) as dif_devengo,
           round(nl.deducciones, 2)                 as ded_guardada
    from public.nomina_lineas nl
  ),
  -- Lo que darían HOY los conceptos vigentes, con la misma aritmética que
  -- `aplicarConceptos`: redondeo a 2 en CADA concepto, y el PORCENTAJE sobre el
  -- salario base (no sobre el devengado).
  calc as (
    select b.linea_id, b.nomina_id, b.client_id,
           ce.concepto_id, ce.nombre, ce.tipo,
           round(case when ce.modo = 'PORCENTAJE'
                      then b.salario_base * ce.valor / 100.0
                      else ce.valor end, 2) as monto
    from base b
    join public.conceptos_empleado ce
      on ce.empleado_id = b.empleado_id and ce.activo
  ),
  sumas as (
    select linea_id,
           coalesce(sum(monto) filter (where tipo = 'BONO'),      0) as s_bonos,
           coalesce(sum(monto) filter (where tipo = 'DEDUCCION'), 0) as s_deduc
    from calc group by linea_id
  ),
  -- Qué eje de cada línea es reconstruible fielmente
  veredicto as (
    select b.*,
           coalesce(s.s_bonos, 0) as s_bonos,
           coalesce(s.s_deduc, 0) as s_deduc,
           (b.dif_devengo  > 0 and b.dif_devengo  = coalesce(s.s_bonos, 0)) as devengo_cuadra,
           (b.ded_guardada > 0 and b.ded_guardada = coalesce(s.s_deduc, 0)) as deduc_cuadra
    from base b left join sumas s on s.linea_id = b.linea_id
  ),
  -- (a) Reconstrucción fiel: un ítem por concepto
  fieles as (
    select c.linea_id, c.nomina_id, c.client_id, c.nombre,
           case when c.tipo = 'BONO' then 'DEVENGO' else 'RETENCION' end as tipo,
           c.monto,
           'CONCEPTO' as origen,
           c.concepto_id as origen_id,
           case when c.tipo = 'DEDUCCION' then 'TERCERO_FISCAL' end as destino
    from calc c
    join veredicto v on v.linea_id = c.linea_id
    where c.monto > 0
      and ((c.tipo = 'BONO' and v.devengo_cuadra) or (c.tipo = 'DEDUCCION' and v.deduc_cuadra))
  ),
  -- (b) Importe heredado sin desglose conocido
  legado as (
    select v.linea_id, v.nomina_id, v.client_id,
           'Devengado heredado' as nombre, 'DEVENGO' as tipo, v.dif_devengo as monto,
           'LEGADO' as origen, null::text as origen_id, null::text as destino
    from veredicto v
    where v.dif_devengo > 0 and not v.devengo_cuadra
    union all
    select v.linea_id, v.nomina_id, v.client_id,
           'Deducción heredada', 'RETENCION', v.ded_guardada,
           'LEGADO', null, 'TERCERO_FISCAL'
    from veredicto v
    where v.ded_guardada > 0 and not v.deduc_cuadra
  ),
  todos as (
    select * from fieles
    union all
    select * from legado
  )
  insert into public.nomina_linea_conceptos
    (item_id, linea_id, nomina_id, client_id, nombre, tipo, monto, origen, origen_id, destino)
  select 'NLC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
         t.linea_id, t.nomina_id, t.client_id, t.nombre, t.tipo, t.monto, t.origen, t.origen_id, t.destino
  from todos t;

  get diagnostics v_insertados = row_count;
  raise notice 'Relleno de nomina_linea_conceptos: % ítems creados.', v_insertados;
end $$;

-- ── 4. Verificación del relleno: ninguna cifra puede haberse movido ───────────
-- La invariante tiene que cumplirse en TODA línea que haya recibido ítems. Si no,
-- la migración se aborta entera: es preferible no migrar a migrar descuadrado.
do $$
declare
  v_malas int;
begin
  select count(*) into v_malas
  from public.nomina_lineas nl
  join (
    select linea_id,
           coalesce(sum(monto) filter (where tipo = 'DEVENGO'),   0) as sum_dev,
           coalesce(sum(monto) filter (where tipo = 'RETENCION'), 0) as sum_ret
    from public.nomina_linea_conceptos group by linea_id
  ) i on i.linea_id = nl.linea_id
  where abs((nl.salario_base + i.sum_dev) - nl.devengado)   > 0.005
     or abs(i.sum_ret                     - nl.deducciones) > 0.005;

  if v_malas > 0 then
    raise exception 'Relleno inconsistente en % líneas: los ítems no reproducen devengado/deducciones.', v_malas;
  end if;
  raise notice 'Relleno verificado: los ítems reproducen exactamente devengado y deducciones.';
end $$;

-- ── 5. Purga del tenant ───────────────────────────────────────────────────────
-- El CASCADE de `nlc_linea_fk` ya se lleva los ítems cuando se borran las líneas,
-- pero la función enumera sus tablas a propósito (estilo del repo: la cascada es
-- explícita y auditable). Va ANTES de nomina_lineas.
create or replace function eliminar_cliente(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from clients where client_id = p_client_id) then
    raise exception 'El cliente % no existe.', p_client_id;
  end if;

  if exists (select 1 from payments where client_id = p_client_id and estado = 'confirmado') then
    raise exception 'El cliente % tiene pagos confirmados; no se puede borrar (archívalo).', p_client_id;
  end if;

  delete from caja_ticket_lineas        where client_id = p_client_id;
  delete from caja_tickets              where client_id = p_client_id;
  delete from caja_sesiones             where client_id = p_client_id;
  delete from cajas                     where client_id = p_client_id;
  delete from ofertas                   where client_id = p_client_id;
  delete from facturas                  where client_id = p_client_id;
  delete from compra_lineas             where client_id = p_client_id;
  delete from compras                   where client_id = p_client_id;
  delete from movimientos_inventario    where client_id = p_client_id;
  delete from stock_almacenes           where client_id = p_client_id;
  delete from producto_precios_historial where client_id = p_client_id;
  delete from movimientos_tesoreria     where client_id = p_client_id;
  delete from gastos_cobros             where client_id = p_client_id;
  delete from cuentas                   where client_id = p_client_id;
  delete from categorias_gastos         where client_id = p_client_id;
  delete from nomina_linea_conceptos    where client_id = p_client_id;
  delete from nomina_lineas             where client_id = p_client_id;
  delete from nominas                   where client_id = p_client_id;
  delete from conceptos_empleado        where client_id = p_client_id;
  delete from turno_asignaciones        where client_id = p_client_id;
  delete from turnos                    where client_id = p_client_id;
  delete from contratos                 where client_id = p_client_id;
  delete from empleados                 where client_id = p_client_id;
  delete from recurso_horarios          where client_id = p_client_id;
  delete from reserva_franjas           where client_id = p_client_id;
  delete from reserva_cierres           where client_id = p_client_id;
  delete from reservas                  where client_id = p_client_id;
  delete from servicios                 where client_id = p_client_id;
  delete from recursos                  where client_id = p_client_id;
  delete from catalogo_items            where client_id = p_client_id;
  delete from catalogo_categorias       where client_id = p_client_id;
  delete from product_categories        where client_id = p_client_id;
  delete from products                  where client_id = p_client_id;
  delete from almacenes                 where client_id = p_client_id;
  delete from tasas_cambio              where client_id = p_client_id;
  delete from pares_tasa                where client_id = p_client_id;
  delete from monedas                   where client_id = p_client_id;
  delete from third_parties             where client_id = p_client_id;
  delete from ia_uso                    where client_id = p_client_id;
  delete from ia_conversaciones         where client_id = p_client_id;
  delete from consecutivos_venta        where client_id = p_client_id;
  delete from consecutivos_compra       where client_id = p_client_id;
  delete from telegram_updates          where client_id = p_client_id;
  delete from telegram_sessions         where client_id = p_client_id;
  delete from soporte_mensajes          where client_id = p_client_id;
  delete from presupuestos_instalacion  where client_id = p_client_id;
  delete from payments                  where client_id = p_client_id;
  delete from empresas                  where client_id = p_client_id;
  delete from client_users              where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$$;

grant execute on function eliminar_cliente(text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ================================================================
-- MIGRACIÓN 142: Nómina · modelo MIPYME_CUBA
--
-- El modelo de nómina se activa POR EMPRESA, no por cliente: un negocio con tres
-- empresas puede tener una en el modelo cubano y dos en el general. Nunca los dos
-- a la vez en la misma empresa.
--
-- MIPYME_CUBA no es un sistema paralelo: es el General con una fuente de ítems más
-- (la LEY) y una entrada de datos más (las incidencias del mes). Por eso no hay un
-- motor nuevo ni una tabla de desglose nueva — reutiliza `nomina_linea_conceptos`
-- de la mig. 140, y el tercer tipo de ítem que se creó allí sin usarlo todavía,
-- `APORTE_EMPRESA`, es exactamente lo que hacía falta para el IUFT y la
-- Contribución a la Seguridad Social: obligaciones que paga la empresa POR ENCIMA
-- del bruto, que no reducen el neto del trabajador pero sí son coste de personal.
--
-- ── LOS TIPOS SON DATOS, NO CÓDIGO ───────────────────────────────────────────
-- `parametros_fiscales_cuba` guarda cada tributo con su vigencia y su tabla de
-- tramos. Cuando ONAT publique un cambio: se cierra la vigencia de la fila
-- anterior y se inserta una nueva. No se toca código, salvo que cambie la
-- ESTRUCTURA del tributo (un tramo con una lógica distinta a «porcentaje sobre el
-- exceso»). Y la nómina usa siempre la fila vigente EN SU FECHA, con el resultado
-- congelado en sus ítems: si la ley cambia después, lo confirmado no se toca.
--
-- Es una tabla GLOBAL (sin `client_id`), como `plantillas_sector`: son parámetros
-- de ley, no configuración comercial del negocio. Por eso NO entra en
-- `eliminar_cliente()`.
--
-- ⚠️  ── LOS VALORES SEMBRADOS AQUÍ SON PROVISIONALES ────────────────────────
-- La verificación normativa (el documento `nomina-cuba-normativa-y-plan.md` que
-- cita el pliego) NO existe en este repo, así que faltan la tabla de tramos del
-- IRPF y los tipos de CESS e IUFT. Lo que se siembra aquí son valores de relleno
-- para que el sistema ARRANQUE y se pueda probar el flujo entero, y van marcados
-- con `provisional = true`.
--
-- Mientras esa marca esté puesta, `confirmarNomina` SE NIEGA a confirmar una
-- nómina del modelo cubano. Generar el borrador y verlo, sí; postear a
-- contabilidad, no — confirmar crea una deuda real con ONAT y con la Seguridad
-- Social, y hacerlo por un importe inventado es peor que no poder hacerlo.
--
-- Lo que SÍ está confirmado por Claudia y va sin marca de provisional:
--   · Contribución SS de empresa: 12,5 % y 1,5 %
--   · Acumulación de vacaciones: 9,09 %
--   · El socio se salta ÚNICAMENTE la CESS; el IUFT se le calcula igual
--   · Base del IUFT y de la SS de empresa: devengado + acumulación de vacaciones
--     del mes (no el pago real de vacaciones cuando se disfrutan)
--
-- PRUEBA DE ACEPTACIÓN para los valores reales, cuando lleguen: con la ficha de
-- CLI-0014 (salario 27.500 CUP), el IRPF tiene que dar exactamente 3.712,00 —
-- que es el dato observado en producción, un 13,498 %, no un porcentaje redondo.
-- La escala provisional de aquí NO lo reproduce, y es a propósito: si coincidiera
-- por casualidad, parecería validada.
--
-- Plan completo y lista exacta de lo que falta:
--   docs/planes/nomina-plan-completo.md §2 y §16
-- ================================================================

-- ── 1. El modelo de nómina, por empresa ───────────────────────────────────────
create table if not exists public.empresa_config_nomina (
  empresa_id              text primary key,
  client_id               text not null,
  modelo                  text not null default 'GENERAL',
  dias_laborables_default numeric not null default 24,
  updated_at              timestamptz not null default now(),

  constraint ecn_modelo_ck check (modelo in ('GENERAL','MIPYME_CUBA')),
  constraint ecn_dias_ck   check (dias_laborables_default > 0 and dias_laborables_default <= 31)
);

create index if not exists idx_ecn_client on public.empresa_config_nomina (client_id);
alter table public.empresa_config_nomina enable row level security;

-- ── 2. Parámetros fiscales versionados (tabla GLOBAL) ─────────────────────────
create table if not exists public.parametros_fiscales_cuba (
  parametro_id  text primary key,
  concepto      text not null,
  vigente_desde date not null,
  vigente_hasta date,                     -- null = vigente ahora
  -- [{desde, hasta|null, tasa, acumulado_base}] — el importe de un tramo es
  --   acumulado_base + (base - desde) * tasa / 100
  -- Un tipo plano es un solo tramo con desde=0, hasta=null, acumulado_base=0.
  tabla_tramos  jsonb not null,
  -- Sobre QUÉ se aplica. Es un dato y no una constante en el motor porque la base
  -- de cada tributo es tan corregible como su tipo, y si viviera en el código
  -- cambiarla exigiría un despliegue.
  base_calculo  text not null default 'DEVENGADO',
  -- true = valor de relleno, no verificado contra la norma. Bloquea confirmar.
  provisional   boolean not null default false,
  notas         text,
  created_at    timestamptz not null default now(),

  constraint pfc_concepto_ck check (concepto in
    ('IRPF','CESS','IUFT','SS_EMPRESA_125','SS_EMPRESA_15','VACACIONES')),
  constraint pfc_base_ck check (base_calculo in
    ('SALARIO_BASE','DEVENGADO','DEVENGADO_MAS_VACACIONES')),
  constraint pfc_vigencia_ck check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

create index if not exists idx_pfc_vigencia
  on public.parametros_fiscales_cuba (concepto, vigente_desde desc);

alter table public.parametros_fiscales_cuba enable row level security;

-- ── 3. Ficha del trabajador ───────────────────────────────────────────────────
alter table public.empleados
  -- Si es socio, se le omite ÚNICAMENTE la CESS. Todo lo demás (IRPF, IUFT,
  -- Contribución SS de empresa) se le calcula igual. Confirmado por Claudia.
  -- Ojo: la ficha es POR EMPRESA, así que la misma persona puede ser socia en una
  -- y no en otra — son dos relaciones laborales distintas, y es correcto.
  add column if not exists es_socio       boolean not null default false,
  -- Override del default de la empresa. Sustituye al patrón de la hoja del cliente
  -- (10 días para ciertos cargos, 24 para el resto) por un dato explícito, en vez
  -- de una fórmula que deducía los días leyendo el CARGO por texto.
  add column if not exists dias_laborables numeric;

-- ── 4. Vacaciones en la línea ─────────────────────────────────────────────────
-- El SALDO no se guarda en la ficha: se DERIVA de estas dos columnas sobre las
-- nóminas confirmadas. Guardarlo como total mutable se rompía en dos caminos que
-- ya existen —`reabrirYActualizarNomina` y `eliminarNomina` revierten la nómina y
-- nada decrementaría el saldo—, así que al reconfirmar se acumularía dos veces.
alter table public.nomina_lineas
  add column if not exists vacaciones_acumuladas_periodo numeric not null default 0,
  add column if not exists vacaciones_pagadas_periodo    numeric not null default 0;

-- ── 5. Las dos categorías de gasto nuevas ─────────────────────────────────────
-- El `rol_pl` lo fija la RPC y no el llamador (lección de la mig. 139): si lo
-- pusiera quien llama, cada módulo tendría su propia opinión y la misma categoría
-- nacería con un papel distinto según por dónde se entrase.
-- Con las CUATRO bajo PERSONAL, el renglón Personal del estado de resultados pasa
-- a valer el COSTE REAL: devengado + impuestos de salario + contribución SS.
-- Se recrea ENTERA a propósito, conservando su cuerpo tal cual (incluido el
-- manejador de `unique_violation`, que es la defensa ante dos escrituras a la vez
-- creando la misma categoría). Lo único que cambia son las dos claves nuevas del
-- `case`: reescribirla «a ojo» habría perdido esa defensa sin que nada lo avisara.
create or replace function cat_gasto_sistema(
  p_client_id text,
  p_clave     text,
  p_nombre    text
) returns text
language plpgsql as $$
declare
  v_id  text;
  v_rol text;
begin
  v_rol := case p_clave
             when 'compras'                 then 'COSTE_VENTAS'
             when 'servicios_terceros'      then 'COSTE_VENTAS'
             when 'salarios'                then 'PERSONAL'
             when 'retenciones_nomina'      then 'PERSONAL'
             when 'impuestos_salario'       then 'PERSONAL'   -- nuevo (mig. 142)
             when 'contribucion_ss_empresa' then 'PERSONAL'   -- nuevo (mig. 142)
             when 'comisiones_bancarias'    then 'OTRO'
             else 'OPERATIVO'
           end;

  select categoria_id into v_id from categorias_gastos
   where client_id = p_client_id and clave_sistema = p_clave
   limit 1;
  if v_id is not null then return v_id; end if;

  select categoria_id into v_id from categorias_gastos
   where client_id = p_client_id and nombre = p_nombre and parent_id is null
   limit 1;
  if v_id is not null then
    update categorias_gastos
       set clave_sistema = p_clave, es_sistema = true,
           rol_pl = case when rol_pl = 'OPERATIVO' then v_rol else rol_pl end,
           updated_at = now()
     where categoria_id = v_id;
    return v_id;
  end if;

  v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  begin
    insert into categorias_gastos (categoria_id, client_id, nombre, clave_sistema, es_sistema, rol_pl, updated_at)
    values (v_id, p_client_id, p_nombre, p_clave, true, v_rol, now());
  exception when unique_violation then
    select categoria_id into v_id from categorias_gastos
     where client_id = p_client_id and clave_sistema = p_clave limit 1;
    if v_id is null then
      select categoria_id into v_id from categorias_gastos
       where client_id = p_client_id and nombre = p_nombre and parent_id is null limit 1;
    end if;
  end;

  return v_id;
end; $$;

-- ── 6. Purga del tenant ───────────────────────────────────────────────────────
-- `parametros_fiscales_cuba` NO va aquí: es global, no tiene client_id.
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
  delete from deducciones_reglas        where client_id = p_client_id;
  delete from empresa_config_nomina     where client_id = p_client_id;
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

-- ── 7. Semilla ────────────────────────────────────────────────────────────────
-- Vigencia abierta desde 2020 para que cualquier nómina histórica encuentre fila.
insert into public.parametros_fiscales_cuba
  (parametro_id, concepto, vigente_desde, tabla_tramos, base_calculo, provisional, notas)
values
  -- ✅ CONFIRMADOS por Claudia
  ('PFC-VACAC001', 'VACACIONES', '2020-01-01',
   '[{"desde":0,"hasta":null,"tasa":9.09,"acumulado_base":0}]'::jsonb,
   'DEVENGADO', false,
   'Acumulación de vacaciones: 9,09 % del devengado del período. Confirmado.'),

  ('PFC-SSEMP125', 'SS_EMPRESA_125', '2020-01-01',
   '[{"desde":0,"hasta":null,"tasa":12.5,"acumulado_base":0}]'::jsonb,
   'DEVENGADO_MAS_VACACIONES', false,
   'Contribución a la Seguridad Social a cargo de la empresa, 12,5 %. Confirmado. '
   'Base: devengado + acumulación de vacaciones del mes.'),

  ('PFC-SSEMP015', 'SS_EMPRESA_15', '2020-01-01',
   '[{"desde":0,"hasta":null,"tasa":1.5,"acumulado_base":0}]'::jsonb,
   'DEVENGADO_MAS_VACACIONES', false,
   'Segundo tramo de la Contribución a la Seguridad Social de empresa, 1,5 %. Confirmado.'),

  -- ⚠️  PROVISIONALES — pendientes de la verificación normativa
  ('PFC-CESS0001', 'CESS', '2020-01-01',
   '[{"desde":0,"hasta":null,"tasa":5,"acumulado_base":0}]'::jsonb,
   'DEVENGADO', true,
   'PROVISIONAL. Falta el tipo real de la Contribución Especial a la Seguridad '
   'Social y su base. Se siembra un 5 % plano sobre el devengado solo para que el '
   'motor arranque. Se omite si el trabajador es socio.'),

  ('PFC-IUFT0001', 'IUFT', '2020-01-01',
   '[{"desde":0,"hasta":null,"tasa":5,"acumulado_base":0}]'::jsonb,
   'DEVENGADO_MAS_VACACIONES', true,
   'PROVISIONAL. Falta el tipo real del Impuesto por la Utilización de la Fuerza '
   'de Trabajo. La BASE sí está confirmada (devengado + acumulación de vacaciones). '
   'Se siembra un 5 % solo para que el motor arranque.'),

  ('PFC-IRPF0001', 'IRPF', '2020-01-01',
   '[{"desde":0,"hasta":10000,"tasa":0,"acumulado_base":0},
     {"desde":10000,"hasta":20000,"tasa":15,"acumulado_base":0},
     {"desde":20000,"hasta":30000,"tasa":20,"acumulado_base":1500},
     {"desde":30000,"hasta":50000,"tasa":30,"acumulado_base":3500},
     {"desde":50000,"hasta":null,"tasa":50,"acumulado_base":9500}]'::jsonb,
   'DEVENGADO', true,
   'PROVISIONAL Y SEGURAMENTE INCORRECTA. Escala progresiva de relleno, puesta '
   'solo para que el motor tenga tramos que recorrer. NO reproduce el dato real de '
   'produccion (3.712,00 sobre 27.500,00 = 13,498 %), y es a proposito: si '
   'coincidiera parecería validada. Ese dato es la PRUEBA DE ACEPTACION de la '
   'escala verdadera.')
on conflict (parametro_id) do nothing;

notify pgrst, 'reload schema';

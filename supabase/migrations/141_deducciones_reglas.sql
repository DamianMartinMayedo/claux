-- ================================================================
-- MIGRACIÓN 141: Nómina · una regla del negocio se escribe UNA vez
--
-- PROBLEMA. `conceptos_empleado` es un único mecanismo —un valor fijo por
-- trabajador— haciendo el trabajo de tres cosas distintas:
--
--   (a) REGLA DEL NEGOCIO   «así funciona mi nómina»      → igual para todos
--   (b) FIJO DEL TRABAJADOR «a esta persona, además…»     → de uno
--   (c) PUNTUAL DEL MES     «una rotura, en marzo»        → de uno, un mes
--
-- (c) se resolvió en la mig. 140 (ítems `PUNTUAL`). Aquí se separa (a) de (b),
-- que es lo que hoy más duele: en el partner real, una retención igual para toda
-- la plantilla son **39 altas a mano**, de una en una, en un formulario inline. Y
-- como `guardarConceptoEmpleado` SOLO hacía `insert`, cambiar su importe eran 39
-- borrados + 39 altas. Con una persona empleada por dos empresas, más de 39 filas
-- para menos de 39 personas.
--
-- MODELO. `deducciones_reglas` vive a nivel de cliente (o de una empresa suya) y
-- se aplica sola a todos. El trabajador solo necesita fila propia cuando es
-- EXCEPCIÓN, y para eso `conceptos_empleado` gana dos columnas:
--   · regla_id  → «mi valor para esta regla» (sobrescribe modo y valor)
--   · excluida  → «a mí esta regla no se me aplica»
--
-- Orden de resolución al generar o recalcular una línea:
--     reglas de la empresa → excepciones del trabajador → conceptos propios
--     → ítems PUNTUAL ya presentes (que se conservan, mig. 140)
--
-- ── DOS SANEAMIENTOS QUE VENÍAN DE LEJOS ─────────────────────────────────────
-- 1. `base`: el PORCENTAJE se calculaba SIEMPRE sobre `salario_base`, nunca sobre
--    el devengado, así que con un bono de por medio una retención porcentual
--    quedaba infra-calculada y nadie lo veía. Ahora cada regla y cada concepto
--    dicen su base. El defecto es SALARIO_BASE = lo que se venía haciendo, para
--    que esta migración no mueva ni un importe existente.
-- 2. `recurrencia`: un concepto puede ser PUNTUAL y morir solo al confirmarse la
--    nómina de su período, en vez de repetirse para siempre.
--
-- ── VOCABULARIO UNIFICADO ────────────────────────────────────────────────────
-- `tipo` pasa de BONO|DEDUCCION a DEVENGO|RETENCION, el mismo vocabulario que los
-- ítems de la mig. 140. Tener dos nombres para lo mismo obligaba a traducir en
-- cada frontera, y una traducción es un sitio donde equivocarse. `APORTE_EMPRESA`
-- se admite en las reglas (no en los conceptos): es lo que la empresa paga por
-- ENCIMA del bruto, y llega de verdad con el motor legal cubano.
--
-- Plan completo: docs/planes/nomina-plan-completo.md §3.2, §3.5 y §7
-- ================================================================

-- ── 1. Reglas del negocio ─────────────────────────────────────────────────────
create table if not exists public.deducciones_reglas (
  regla_id   text primary key,
  client_id  text not null,
  -- NULL = todas las empresas del cliente. Una regla suele ser del negocio
  -- entero, y obligar a repetirla por empresa sería reproducir el problema que
  -- esta tabla viene a resolver, un nivel más arriba.
  empresa_id text,
  nombre     text not null,
  tipo       text not null,
  modo       text not null default 'FIJO',
  valor      numeric(18,2) not null default 0,
  base       text not null default 'SALARIO_BASE',
  destino    text,
  activa     boolean not null default true,
  orden      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint drg_tipo_ck check (tipo in ('DEVENGO','RETENCION','APORTE_EMPRESA')),
  constraint drg_modo_ck check (modo in ('FIJO','PORCENTAJE')),
  constraint drg_base_ck check (base in ('SALARIO_BASE','DEVENGADO')),
  constraint drg_destino_ck check (
    destino is null or (tipo = 'RETENCION' and destino in ('TERCERO_FISCAL','EMPRESA'))
  ),
  -- Un porcentaje no puede pasar del 100 %: teclear «10» como «1000» retenía el
  -- salario entero, se recortaba y el neto quedaba a cero.
  constraint drg_valor_ck check (
    valor >= 0 and (modo <> 'PORCENTAJE' or valor <= 100)
  )
);

create index if not exists idx_drg_client  on public.deducciones_reglas (client_id);
create index if not exists idx_drg_empresa on public.deducciones_reglas (client_id, empresa_id);

alter table public.deducciones_reglas enable row level security;

-- ── 2. Conceptos del trabajador: columnas nuevas ──────────────────────────────
alter table public.conceptos_empleado
  add column if not exists base              text    not null default 'SALARIO_BASE',
  add column if not exists recurrencia       text    not null default 'RECURRENTE',
  add column if not exists periodo_aplicable text,
  add column if not exists destino           text,
  add column if not exists regla_id          text,
  add column if not exists excluida          boolean not null default false,
  add column if not exists updated_at        timestamptz not null default now();

-- ── 3. Vocabulario: BONO|DEDUCCION → DEVENGO|RETENCION ────────────────────────
update public.conceptos_empleado set tipo = 'DEVENGO'   where tipo = 'BONO';
update public.conceptos_empleado set tipo = 'RETENCION' where tipo = 'DEDUCCION';

-- Toda retención existente se le sigue debiendo a la agencia tributaria, que es
-- lo que el sistema asumía hasta ahora: el relleno conserva ese significado en
-- vez de inventar uno nuevo.
update public.conceptos_empleado set destino = 'TERCERO_FISCAL'
 where tipo = 'RETENCION' and destino is null;

-- ── 4. Guardias de conceptos_empleado ─────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cpt_tipo_ck') then
    alter table public.conceptos_empleado
      add constraint cpt_tipo_ck check (tipo in ('DEVENGO','RETENCION'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cpt_base_ck') then
    alter table public.conceptos_empleado
      add constraint cpt_base_ck check (base in ('SALARIO_BASE','DEVENGADO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cpt_recurrencia_ck') then
    alter table public.conceptos_empleado
      add constraint cpt_recurrencia_ck check (
        recurrencia in ('RECURRENTE','PUNTUAL')
        -- Un PUNTUAL sin período no sabe cuándo aplicarse ni cuándo morir.
        and (recurrencia <> 'PUNTUAL' or periodo_aplicable ~ '^\d{4}-\d{2}$')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cpt_destino_ck') then
    alter table public.conceptos_empleado
      add constraint cpt_destino_ck check (
        destino is null or (tipo = 'RETENCION' and destino in ('TERCERO_FISCAL','EMPRESA'))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cpt_valor_ck') then
    alter table public.conceptos_empleado
      add constraint cpt_valor_ck check (
        valor >= 0 and (modo <> 'PORCENTAJE' or valor <= 100)
      );
  end if;
end $$;

-- Una sola excepción por trabajador y regla: dos filas para la misma regla no
-- tendrían un ganador definido y el importe dependería del orden de lectura.
create unique index if not exists uq_cpt_excepcion
  on public.conceptos_empleado (client_id, empleado_id, regla_id)
  where regla_id is not null;

create index if not exists idx_cpt_regla on public.conceptos_empleado (regla_id)
  where regla_id is not null;

-- ── 5. Purga del tenant ───────────────────────────────────────────────────────
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

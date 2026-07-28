-- ================================================================
-- MIGRACIÓN 144: Nómina · el subsidio no es un gasto, es un activo
--
-- EL PROBLEMA DE FONDO, que es el más sutil de todo el rediseño. En este sistema
-- una fila de `gastos_cobros` es a la vez EL GASTO y LA DEUDA: el saldo y el estado
-- (pendiente/parcial/liquidado) se derivan de sus movimientos de Tesorería. Eso
-- funciona porque hasta ahora el coste de personal y lo que se debe coincidían
-- siempre.
--
-- El subsidio es el primer caso en que dejan de coincidir:
--
--   El trabajador COBRA          neto, que incluye el subsidio
--   A la empresa le CUESTA       el devengado — el subsidio NO
--   La diferencia es un ACTIVO   se lo recupera de la Seguridad Social
--
-- El borrador del plan lo resolvía sumando el subsidio al neto y posteando el gasto
-- «Salarios» por Σ netos. Eso lo contaba DOS VECES: engordaba el coste de personal
-- del estado de resultados Y además creaba la cuenta por cobrar. Es el mismo tipo de
-- error que arregló la mig. 139 con las retenciones, solo que con el signo cambiado.
--
-- SOLUCIÓN. El gasto «Salarios» se calcula sobre el DEVENGADO (que no incluye el
-- subsidio) y el subsidio va en su propia fila de COBRO pendiente contra la
-- Seguridad Social, liquidable en Tesorería el día que llegue el reembolso.
-- Confirmado por Claudia: **se cobra aparte, no se compensa** contra la Contribución
-- a la Seguridad Social que la empresa ya debe.
--
-- Esa fila va SIN `categoria_id` a propósito: `categorias_gastos` alimenta el estado
-- de resultados por su `rol_pl`, y esto no es una línea del P&L sino un saldo por
-- cobrar. Darle categoría lo colaría en el informe como si fuera resultado.
--
-- ── LOS ANTICIPOS QUEDAN FUERA DE ALCANCE ────────────────────────────────────
-- El plan preveía también el caso simétrico: una deducción que NO se le debe a
-- nadie porque es dinero que la empresa ya adelantó (`destino = 'EMPRESA'`).
-- Claudia confirmó que **no se usan anticipos de salario en la práctica**, así que
-- no se implementa. La columna `destino` se queda en el modelo —cuesta cero y el día
-- que aparezca un anticipo estará lista— pero solo se emite `TERCERO_FISCAL`, y
-- `EMPRESA` no se ofrece en ninguna interfaz.
--
-- Plan: docs/planes/nomina-plan-completo.md §5
-- ================================================================

alter table public.incidencias_nomina
  add column if not exists pago_subsidios numeric not null default 0;

alter table public.incidencias_nomina
  drop constraint if exists inc_subsidios_ck;
alter table public.incidencias_nomina
  add constraint inc_subsidios_ck check (pago_subsidios >= 0);

-- En la línea NO es un ítem. Un ítem DEVENGO sumaría al devengado, y el devengado es
-- exactamente lo que NO debe incluirlo: es la cifra sobre la que se calcula el coste
-- y los tributos. Viaja como columna propia y solo afecta al neto.
alter table public.nomina_lineas
  add column if not exists subsidios numeric not null default 0;

-- La purga del tenant recoge además `incidencias_nomina` (mig. 143), que se dejó
-- para aquí para no recrear la función dos veces seguidas.
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
  delete from incidencias_nomina        where client_id = p_client_id;
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

notify pgrst, 'reload schema';

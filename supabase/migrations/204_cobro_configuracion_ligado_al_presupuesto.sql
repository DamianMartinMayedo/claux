-- ================================================================
-- MIGRACIÓN 204: el cobro de configuración sabe de qué presupuesto sale
--
-- El pago único de configuración (`payments.concepto = 'configuracion'`) nacía
-- como una COPIA MUERTA del presupuesto: el alta lo creaba con el importe que
-- tenía el presupuesto en ese instante y nadie lo volvía a tocar jamás. Con la
-- edición de borradores y la re-aprobación (feat 04cecfa), el presupuesto cambia
-- y el cobro se queda en la cifra vieja — que es justo la que el cliente ve en su
-- panel (Suscripción → Historial de pagos) y la que aparece en la ficha del
-- admin. Casos reales: CLI-0008 cobrando $180 con el presupuesto aprobado en
-- $340, y CLI-0014 cobrando $1.000 con el suyo al 100% de descuento ($0).
--
-- El vínculo convierte esa copia en una referencia: un cobro POR CONFIRMAR ligado
-- a un presupuesto vale siempre lo que vale ese presupuesto (lo sincroniza
-- `sincronizarCobroConfiguracion` al aprobar y al editar). En cuanto se confirma
-- —el dinero entró— se congela y ya no lo toca nadie.
--
-- `on delete set null` y no cascade: borrar un presupuesto no puede borrar el
-- registro de un cobro; el cobro sobrevive huérfano, que es lo honesto.
-- ================================================================

alter table payments
  add column if not exists presupuesto_id bigint
    references presupuestos_instalacion(id) on delete set null;

create index if not exists idx_payments_presupuesto on payments (presupuesto_id);

-- Backfill CONSERVADOR: solo se ata el cobro cuyo importe YA coincide con el del
-- presupuesto (no hay nada que decidir ahí). Los que discrepan se dejan sueltos a
-- propósito: los adopta el primer `sincronizarCobroConfiguracion` —o los borra el
-- admin desde la ficha—, porque elegir por él a qué presupuesto pertenece un
-- cobro que no cuadra con ninguno es inventarse el dato.
update payments p
set    presupuesto_id = pr.id
from   presupuestos_instalacion pr
where  p.presupuesto_id is null
  and  p.concepto   = 'configuracion'
  and  p.estado     = 'por_confirmar'
  and  pr.client_id = p.client_id
  and  pr.estado in ('aprobado', 'instalado')
  and  pr.total_final_usd = p.monto_usd;

-- ── La versión del Anexo I firmado pasa a sellar su CONTENIDO ──
--
-- Era `presupuesto-<id>` a secas, y como editar un borrador conserva el id, un
-- Anexo ya firmado seguía contando como firmado con otros números dentro — lo
-- contrario de lo que promete `presupuesto-anexo.ts`. Ahora la versión lleva
-- ciclo, tarifa, módulos y los dos importes, así que un cambio la mueve y obliga
-- a re-firmar (el único parcial de mig. 201 es por versión: la firma nueva ya no
-- choca con la vieja, que queda en histórico como prueba de lo que se firmó).
--
-- Se renombra la versión de las firmas VIGENTES cuyo contenido no ha cambiado:
-- sin esto, el cliente que firmó ayer vería su Anexo como «pendiente» y tendría
-- que firmar otra vez lo mismo. El hash y el snapshot no se tocan.
update firmas_documentos f
set    version = 'presupuesto-' || pr.id
                 || '-' || coalesce(c.ciclo_facturacion, 'mensual')
                 || '-' || coalesce(pr.tarifa, c.tarifa, 'estandar')
                 || '-' || (
                      select string_agg(m, '+' order by m)
                      from unnest(
                        case when coalesce(array_length(pr.modulos, 1), 0) > 0
                             then pr.modulos
                             else coalesce(c.modulos_activos, '{}'::text[])
                        end
                      ) as m
                    )
                 || '-' || to_char(coalesce(c.precio_mensual_usd, 0), 'FM9999999990.00')
                 || '-' || to_char(coalesce(pr.total_final_usd, 0), 'FM9999999990.00')
from   presupuestos_instalacion pr
join   clients c on c.client_id = pr.client_id
where  f.tipo        = 'presupuesto'
  and  f.caducada_at is null
  and  f.version     = 'presupuesto-' || pr.id
  and  pr.client_id  = f.client_id;

notify pgrst, 'reload schema';

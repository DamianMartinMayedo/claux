-- ================================================================
-- MIGRACIÓN 161: el ciclo de vida del acuerdo (pausa, reanudación y baja)
--
-- PROBLEMA. Pausar, reanudar, renovar y cancelar cambian `estado` y NO tocan el
-- calendario de cobro, así que el dinero no cuadra con lo que el dueño cree
-- haber hecho:
--
--   · PAUSAR no registra cuándo. Al reanudar, `fecha_proximo_cobro` sigue donde
--     estaba, así que el calendario presenta **un cobro «Atrasado» por cada mes
--     pausado** y el cron los factura uno por día. La decisión 12 del plan del
--     módulo dice literalmente «PAUSADA no es adorno: un socio que se va dos
--     meses no es una baja» — y el modelo se los cobraba igual.
--   · CANCELAR no registra cuándo. `updated_at` no sirve: es mutable y cualquier
--     edición del acuerdo lo pisa, así que las bajas del mes (el churn del MRR)
--     saldrían inventadas.
--
-- Sin `pausada_desde` la resta no se puede hacer: no hay dónde leer cuántos
-- ciclos cayeron dentro de la pausa.
--
-- POR QUÉ TRES COLUMNAS ADITIVAS Y NADA MÁS. Son de esquema, o sea GLOBALES a
-- todos los tenants, así que van **nullable y sin relleno**: ningún acuerdo
-- existente cambia de comportamiento al aplicar esto (una PAUSADA de antes no
-- tiene `pausada_desde`, y reanudarla se comporta como hoy — no se salta ningún
-- ciclo, que es lo honesto cuando no se sabe desde cuándo estaba parada).
--
-- `pausada_hasta` es la reanudación PROGRAMADA (opcional): vacío = indefinida,
-- que es lo de hoy. Un escáner del cron diario reanuda las que llegan a su
-- fecha, aplicando la misma regla que la reanudación a mano.
--
-- LO QUE **NO** LLEVA. «Cancelar al final del período» no necesita columna: es
-- `fecha_fin = fecha_proximo_cobro - 1 día` + `renovacion_automatica = false`.
-- El estado efectivo pasa a VENCIDA solo (se DERIVA, no se guarda), el preview
-- deja de ofrecerla y el resto del módulo ya lo entiende. Una columna
-- `cancelar_al_final` sería un segundo sitio donde vive la misma verdad.
--
-- Sin RLS y sin tocar `eliminar_cliente()`: no hay tabla nueva; `suscripciones`
-- ya está en la purga del tenant (mig. 146).
-- ================================================================

alter table suscripciones
  add column if not exists pausada_desde date,
  add column if not exists pausada_hasta date,
  add column if not exists cancelada_at  timestamptz;

comment on column suscripciones.pausada_desde is
  'Fecha en que se pausó. Al reanudar, los ciclos que caen DENTRO de la pausa no se cobran (se avanza fecha_proximo_cobro). NULL = nunca se pausó, o se pausó antes de la mig. 161.';

comment on column suscripciones.pausada_hasta is
  'Reanudación programada, opcional. NULL = pausa indefinida. El cron diario reanuda la que llega a esta fecha.';

comment on column suscripciones.cancelada_at is
  'Cuándo se canceló. Lo consume el churn del MRR: updated_at mentiría porque cualquier edición lo pisa.';

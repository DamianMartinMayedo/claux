-- ================================================================
-- MIGRACIÓN 143: Nómina · lo variable del mes
--
-- PROBLEMA. No había ningún sitio donde cargar los datos que cambian cada mes —
-- días trabajados, nocturnidad, feriados, penalizaciones— salvo editando a mano la
-- línea de una nómina YA generada. Eso perdía el motivo (la línea guardaba un
-- número sin explicación) y lo borraba el primer recálculo.
--
-- La mig. 140 dio sitio a lo puntual con los ítems `PUNTUAL`, pero eso es el ajuste
-- que se hace DENTRO de la nómina, cuando ya la estás revisando. Falta lo de antes:
-- la incidencia se carga en la ficha del trabajador ANTES de generar, que es cuando
-- el dueño tiene los datos del mes delante.
--
-- SIN COLUMNA `consumida`. El borrador del plan la incluía y decía que la
-- incidencia queda «marcada como consumida POR ESTA nómina» — pero un booleano no
-- puede expresar pertenencia a una nómina concreta, y al borrar la nómina nadie lo
-- resetearía: el mes quedaría consumido para siempre y sin forma de regenerarlo.
-- No hace falta ninguna de las dos cosas: la incidencia es DATO DEL PERÍODO y la
-- línea es la foto congelada del RESULTADO. Generar lee; recalcular vuelve a leer;
-- borrar la nómina no deja rastro que limpiar. Idempotente por construcción, que es
-- más robusto que una máquina de estados que puede desincronizarse.
--
-- QUÉ HACE CADA CAMPO al componer la línea:
--   dias_trabajados   → prorratea el salario (solo MIPYME_CUBA, lo aplica el motor)
--   dias_vacaciones   → vacaciones que se PAGAN este mes (solo MIPYME_CUBA)
--   pago_extra        ┐
--   pago_nocturnidad  ├→ ítems DEVENGO, origen INCIDENCIA (en LOS DOS modelos)
--   feriados          ┘
--   penalizacion      ┐
--   otros_descuentos  ┘→ ítems RETENCION, origen INCIDENCIA (en LOS DOS modelos)
--
-- Los importes valen en ambos modelos a propósito: son datos del mes, no ley
-- cubana. Los DÍAS sí son del modelo cubano, porque el general nunca ha
-- prorrateado y cambiarlo ahí alteraría lo que ya cobra la gente.
--
-- NO lleva `pago_subsidios`: llega en la Fase 7 con su cuenta por cobrar. Un
-- subsidio sin contrapartida infla el coste de personal en el estado de resultados,
-- así que se prefiere no poder registrarlo a registrarlo mal.
--
-- El SALDO DE VACACIONES no se guarda en ninguna parte: se DERIVA de
-- `nomina_lineas.vacaciones_*_periodo` sobre las nóminas CONFIRMADAS (mig. 142).
-- Guardarlo como total mutable en la ficha se rompía en dos caminos que ya existen
-- —`reabrirYActualizarNomina` y `eliminarNomina` revierten la nómina y nada
-- decrementaría el saldo—, así que al reconfirmar se acumulaba dos veces.
--
-- Plan: docs/planes/nomina-plan-completo.md §6 y §3.5
-- ================================================================

create table if not exists public.incidencias_nomina (
  incidencia_id    text primary key,
  client_id        text not null,
  empleado_id      text not null,
  periodo          text not null,                 -- 'YYYY-MM'
  dias_trabajados  numeric,                       -- null = mes completo
  dias_vacaciones  numeric not null default 0,
  pago_extra       numeric not null default 0,
  pago_nocturnidad numeric not null default 0,
  feriados         numeric not null default 0,
  penalizacion     numeric not null default 0,
  otros_descuentos numeric not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint inc_periodo_ck check (periodo ~ '^\d{4}-\d{2}$'),
  constraint inc_dias_ck    check (dias_trabajados is null or (dias_trabajados >= 0 and dias_trabajados <= 31)),
  constraint inc_vac_ck     check (dias_vacaciones >= 0 and dias_vacaciones <= 31),
  constraint inc_montos_ck  check (
    pago_extra >= 0 and pago_nocturnidad >= 0 and feriados >= 0
    and penalizacion >= 0 and otros_descuentos >= 0
  )
);

-- Una incidencia por trabajador y mes: dos filas del mismo período no tendrían un
-- ganador definido y el importe dependería del orden de lectura.
create unique index if not exists uq_incidencia_periodo
  on public.incidencias_nomina (client_id, empleado_id, periodo);
create index if not exists idx_inc_periodo on public.incidencias_nomina (client_id, periodo);

alter table public.incidencias_nomina enable row level security;

-- La purga del tenant se actualiza en la migración 144, junto con la de subsidios,
-- para no recrear la función dos veces seguidas.
notify pgrst, 'reload schema';

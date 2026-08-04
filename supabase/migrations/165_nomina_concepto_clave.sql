-- ================================================================
-- MIGRACIÓN 165: Nómina · el ítem gana una IDENTIDAD que no es su nombre
--
-- PROBLEMA. `nomina_linea_conceptos.nombre` es un SNAPSHOT a propósito (mig. 140):
-- lo que se le retuvo a esta persona este mes no puede cambiar porque alguien
-- renombre un concepto después. Pero al no haber ninguna otra identidad, ese texto
-- acabó siendo también la CLAVE con la que el código reconoce cada tributo:
--
--   · `confirmarNomina()` reparte los aportes de empresa comparando
--     `item.nombre === NOMBRE_CONCEPTO_FISCAL[...]`, y de ahí salen las filas de
--     «Impuestos de salario» y «Contribución a la Seguridad Social».
--   · la exportación a Excel hace el camino inverso (nombre → concepto) para
--     rellenar sus columnas fiscales.
--
-- O sea que el snapshot y la clave son el mismo dato con dos exigencias opuestas:
-- uno tiene que poder cambiar y el otro no. Cambiar una letra de un nombre en
-- código —una tilde, un «Impuesto» por «Contribución»— deja de clasificar en
-- SILENCIO: la nómina se confirma igual, pero sus aportes dejan de encontrarse y
-- las deudas con ONAT y la Seguridad Social salen a 0 sin que nada falle.
--
-- Estuvo a punto de pasar: la revisión del modelo de coste/deuda llegó proponiendo
-- renombrar los cinco tributos, y ese cambio —inocente en apariencia— habría
-- descuadrado la contabilidad de toda nómina posterior.
--
-- SOLUCIÓN. La misma que ya usan las categorías de gasto con `clave_sistema`
-- (mig. 133): la identidad es una CLAVE estable y el nombre es solo texto visible.
--
--   nombre         → sigue siendo el snapshot, se imprime tal cual
--   concepto_clave → identidad del concepto, la que compara el código
--
-- NULL a propósito en lo que NO tiene identidad de catálogo: una regla del negocio,
-- un concepto del trabajador, un ajuste PUNTUAL o un importe LEGADO son del cliente
-- y su nombre SÍ es lo único que los define. La clave es solo para el catálogo
-- cerrado del sistema (los cinco tributos, el prorrateo, las vacaciones pagadas y
-- las cinco incidencias del mes).
--
-- SIN CHECK CONSTRAINT, y es deliberado. El catálogo vive en código
-- (`src/lib/rrhh/conceptos.ts`), que es quien lo escribe, y ahí está junto al
-- nombre canónico de cada clave —así no pueden divergir—. Un `check` con la lista
-- cerrada obligaría a una migración para añadir un concepto fijo nuevo, que es
-- justo la fricción que este cambio viene a quitar. Mismo criterio que el catálogo
-- de tipos de notificación.
--
-- BACKFILL. Se rellena por nombre, que es lo único que hay, y solo en los orígenes
-- de catálogo (LEY e INCIDENCIA). Los nombres de la lista son los que el código ha
-- escrito desde la mig. 142: ninguna migración los ha cambiado, así que el backfill
-- es exacto. Lo que no case se queda en NULL y el código cae a la comparación por
-- nombre, igual que hoy: migrar no puede empeorar lo que ya funcionaba.
--
-- Plan: docs/planes/nomina-coste-deuda-plan-de-trabajo.md (Fase 0)
-- ================================================================

alter table public.nomina_linea_conceptos
  add column if not exists concepto_clave text;

comment on column public.nomina_linea_conceptos.concepto_clave is
  'Identidad estable del concepto cuando pertenece al catálogo del sistema (los '
  'cinco tributos cubanos, el prorrateo por días, las vacaciones pagadas y las '
  'incidencias del mes). NULL en REGLA/CONCEPTO/PUNTUAL/LEGADO, donde el nombre '
  'del cliente ES la identidad. El catálogo y el nombre canónico de cada clave '
  'viven en src/lib/rrhh/conceptos.ts.';

-- ── Backfill de lo ya escrito ────────────────────────────────────────────────
-- Los cinco tributos y la acumulación, tal y como los escribe
-- `NOMBRE_CONCEPTO_FISCAL` (src/lib/rrhh/nomina-cuba.ts).
update public.nomina_linea_conceptos set concepto_clave = case nombre
    when 'Contribución Especial a la Seguridad Social'          then 'CESS'
    when 'Impuesto sobre ingresos personales'                   then 'IRPF'
    when 'Impuesto por la Utilización de la Fuerza de Trabajo'  then 'IUFT'
    when 'Contribución a la Seguridad Social (12,5 %)'          then 'SS_EMPRESA_125'
    when 'Contribución a la Seguridad Social (1,5 %)'           then 'SS_EMPRESA_15'
    when 'Acumulación de vacaciones'                            then 'VACACIONES'
    -- Devengos que aporta el propio motor legal.
    when 'Días no trabajados'                                   then 'DIAS_NO_TRABAJADOS'
    when 'Vacaciones pagadas'                                   then 'VACACIONES_PAGADAS'
  end
 where concepto_clave is null
   and origen = 'LEY';

-- Las cinco incidencias del mes (mig. 143), tal y como las escribe
-- `itemsDeIncidencia`.
update public.nomina_linea_conceptos set concepto_clave = case nombre
    when 'Pago extra'       then 'PAGO_EXTRA'
    when 'Nocturnidad'      then 'NOCTURNIDAD'
    when 'Feriados'         then 'FERIADOS'
    when 'Penalización'     then 'PENALIZACION'
    when 'Otros descuentos' then 'OTROS_DESCUENTOS'
  end
 where concepto_clave is null
   and origen = 'INCIDENCIA';

notify pgrst, 'reload schema';

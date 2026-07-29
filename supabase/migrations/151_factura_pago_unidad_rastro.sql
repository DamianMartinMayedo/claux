-- ================================================================
-- MIGRACIÓN 151: cómo te pagan, la unidad de la línea y quién emitió
--
-- Tres columnas de la Fase 6 del plan de contabilidad, sin tabla nueva (nada que
-- añadir a `eliminar_cliente()`).
--
-- 1. `empresas.datos_pago` / `empresas.pie_factura`
--    La factura no decía CÓMO pagarla. En Cuba eso es media conversación: número de
--    tarjeta, Enzona, Transfermóvil, cuenta bancaria. El dueño lo estaba metiendo en
--    las notas de cada documento, a mano, cada vez. Van en la empresa porque son
--    estables y por empresa (dos negocios, dos cuentas), y el PDF los pinta solo si
--    hay contenido: un documento no puede crecer con secciones vacías.
--
-- 2. `documento_lineas.unidad`
--    El catálogo ya tenía `products.unidad` y la factura la ignoraba: «2» en vez de
--    «2 kg». Se guarda EN LA LÍNEA, no se busca en el catálogo al pintar, porque un
--    documento emitido es un registro congelado — cambiar la unidad de un artículo en
--    marzo no puede reescribir la factura de enero (mismo criterio que la foto de
--    costes de `fotoDeCostes`).
--
-- 3. `facturas.emitida_por/emitida_at/anulada_por/anulada_at`
--    Rastro MÍNIMO de las dos transiciones que importan, para poder responder «¿quién
--    anuló esta factura y cuándo?» con más de un encogimiento de hombros. Es la
--    versión corta y deliberada: auditar el resto del portal es una decisión
--    transversal aparte (backlog §6), no algo que se cuela en una fase de facturas.
--    `*_por` guarda el email del usuario del portal, no su id: sobrevive a que la
--    cuenta se borre, que es exactamente cuando querrás saber quién fue.
-- ================================================================

alter table empresas
  add column if not exists datos_pago  text,
  add column if not exists pie_factura text;

comment on column empresas.datos_pago is
  'Cómo te pagan (tarjeta, Enzona, banco…). Se imprime en el PDF bajo «CÓMO PAGAR» si hay contenido.';
comment on column empresas.pie_factura is
  'Texto fijo al pie de las facturas de esta empresa.';

alter table documento_lineas
  add column if not exists unidad text;

comment on column documento_lineas.unidad is
  'Unidad del artículo EN EL MOMENTO del documento (mig. 151). Congelada, no se busca en el catálogo.';

alter table facturas
  add column if not exists emitida_por text,
  add column if not exists emitida_at  timestamptz,
  add column if not exists anulada_por text,
  add column if not exists anulada_at  timestamptz;

comment on column facturas.emitida_por is 'Email del usuario que emitió (rastro mínimo, mig. 151).';
comment on column facturas.anulada_por is 'Email del usuario que anuló (rastro mínimo, mig. 151).';

notify pgrst, 'reload schema';

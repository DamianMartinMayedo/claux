-- ================================================================
-- MIGRACIÓN 232: el texto corto de cada módulo, para la ficha de precios
--
-- La diapositiva «Módulos a la carta» pinta el catálogo entero en fichas de
-- cuatro por página. Ahí no cabe el texto de venta: `beneficio` son dos frases
-- (150-170 caracteres) y `descripcion` ronda las cien, así que cada ficha salía
-- de cuatro y cinco líneas y la rejilla se comía la diapositiva.
--
-- Este es el tercer texto, y no es duplicado: cada uno tiene su sitio.
--   · `descripcion` — QUÉ es. Landing y factura, donde hay sitio para matizar.
--   · `beneficio`   — POR QUÉ le sirve. Diapositiva «Pensado para tu negocio».
--   · `resumen`     — la variante reducida, de dos líneas, para la ficha de
--                     precios, donde el cliente compara trece módulos de golpe
--                     y lo que necesita es saber qué es cada uno, no leérselo.
-- ================================================================

alter table modulos_catalogo add column if not exists resumen text;

-- Semilla defensiva, como la 230: el catálogo comercial es VIVO y su texto se
-- edita desde /admin. `where resumen is null` es lo que impide que una
-- reejecución pise lo que el dueño haya escrito después.
update modulos_catalogo set resumen = v.txt from (values
  ('base',                'Ventas, gastos, cobros y pagos, en varias monedas.'),
  ('inventario',          'Qué tienes, cuánto queda y qué entra y sale.'),
  ('servicios',           'Servicios con precio por moneda y cobro recurrente.'),
  ('rrhh',                'Contratos, turnos, ausencias y nómina.'),
  ('caja',                'Cobra y cierra caja aunque te quedes sin conexión.'),
  ('asistente_ia',        'Atiende a tus clientes y responde a tus preguntas.'),
  ('multiempresa',        'Varias empresas o locales, con el total consolidado.'),
  ('multidossier',        'Un dossier por empresa o por inversor, con su enlace.'),
  ('catalogo_qr',         'Tu carta o catálogo, con fotos y precios, en un QR.'),
  ('agenda',              'Citas por profesional; tus clientes piden hora solos.'),
  ('reservas_citas',      'Tus clientes reservan mesa y tú lo ves en un panel.'),
  ('documentos_imprenta', 'El cliente envía sus documentos antes de recogerlos.'),
  ('dossier',             'Tus números en una presentación para inversores.')
) as v(clave, txt)
where modulos_catalogo.clave = v.clave
  and modulos_catalogo.resumen is null;

notify pgrst, 'reload schema';

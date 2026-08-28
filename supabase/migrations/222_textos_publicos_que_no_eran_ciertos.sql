-- ── Tres textos que el visitante lee y que no decían la verdad ──
--
-- Los tres viven en tablas de contenido, no en el código: la landing y el
-- diagnóstico los leen en vivo (`obtenerCatalogoPublico`). Dos de ellos SÍ tienen
-- editor en el admin (/admin/niveles y /admin/diagnostico): esta migración es una
-- corrección de una vez, no una semilla. Si el dueño los reescribe desde el admin,
-- manda el admin.

-- 1) La descripción del nivel Pro prometía dos cosas que no son ──────────────
--
-- Decía: «Sin límites de capacidad y con el asistente siempre activo.»
--
--   · «Sin límites de capacidad» — casi. Pro es SIN TOPE en las nueve dimensiones
--     de `nivel_limites`… menos una: las conversaciones de IA siguen topadas en
--     5.000 al mes. Un absoluto que tiene una excepción es una promesa que un día
--     hay que explicar.
--   · «con el asistente siempre activo» — esto es directamente falso. El asistente
--     de IA es un MÓDULO que se contrata y se paga aparte (`modulos_catalogo`,
--     clave `asistente_ia`); el nivel no lo regala. Quien contratara Pro esperando
--     la IA incluida tendría razón en quejarse.
--
-- El nivel dimensiona, no incluye módulos: eso ya lo dice la landing («El nivel no
-- cambia los módulos que puedes activar, solo la capacidad de cada uno»). La
-- descripción se pone en paralelo con las otras dos, que describen AL NEGOCIO.
update niveles
   set descripcion = 'Para un negocio grande o en expansión, sin topes de capacidad.'
 where clave = 'pro';

-- 2) Una necesidad del diagnóstico que ocupaba el triple que sus ocho hermanas ─
--
-- Las nueve tarjetas del paso «Necesidades» se leen de un vistazo porque todas
-- caben en una línea. Ésta traía 138 caracteres —dos frases y un punto y coma—
-- contra los 71-87 de las demás: rompía la retícula y se leía como si fuera más
-- importante que el resto, que es justo lo que una lista para elegir no debe hacer.
-- Dice lo mismo: servicios con precio + suscripciones cobradas cada mes.
update diagnostico_necesidades
   set descripcion = 'Tus servicios con su precio, y las suscripciones de tus clientes cobradas cada mes.'
 where clave = 'servicios';

-- 3) El último sector de la lista seguía con el paréntesis interno ────────────
--
-- Misma corrección que la 221 le hizo a «Alquiler (canchas/salas)». «(genérico)»
-- es vocabulario de quien montó la tabla, no del que elige: le está diciendo al
-- visitante que su negocio es el caso por defecto, el que no mereció una opción
-- propia. Va el último de los once, así que hace de cajón de sastre sin necesidad
-- de anunciarlo. Además el rótulo entra tal cual en el informe («para el sector
-- X»), y ahí el paréntesis chirriaba.
update plantillas_sector
   set nombre = 'Servicios'
 where sector = 'servicios';

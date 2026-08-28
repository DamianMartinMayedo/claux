-- ── El rótulo del sector «alquiler», sin los ejemplos entre paréntesis ──
--
-- `plantillas_sector.nombre` NO es una etiqueta interna: se le enseña al visitante
-- en el selector del diagnóstico y en las tarjetas de sector de la landing. Y decía
-- «Alquiler (canchas/salas)», que son dos ejemplos de local metidos en el rótulo:
-- ni son los únicos —una sala de ensayo, un local para fiestas, un coworking— ni
-- hacen falta para entender qué es alquilar por horas. Quien no tiene una cancha
-- se leía fuera de su propia opción.
--
-- El nombre nombra el negocio. Los ejemplos, si hacen falta, van en el texto.
-- Las ETIQUETAS del sector no se tocan: ahí «Cancha» sí es el rótulo que este
-- negocio verá en su portal, y eso lo decide el sector, no el nombre del sector.

update plantillas_sector
   set nombre = 'Alquiler'
 where sector = 'alquiler';

-- ================================================================
-- MIGRACIÓN 206: plantilla de correo `periodo_gracia`
--
-- Aplicar un período especial (`aplicarGracia`, mig. 093 + acciones de cliente)
-- avisaba solo por la campana del portal. El dueño del negocio puede pasar días
-- sin entrar —justo cuando cree que le han cortado el acceso—, así que el aviso
-- que de verdad llega es el correo.
--
-- Dos detalles del texto, decididos a propósito:
--   · NO nombra el motivo interno (cortesía, liquidez, promoción…). Ese campo es
--     para el equipo; al cliente solo se le dice hasta cuándo tiene acceso.
--   · NO dice «período de gracia» ni «período especial»: el primero suena a
--     morosidad y el segundo es, en Cuba, el nombre de la crisis de los 90.
--
-- La fila es obligatoria, no solo recomendable: `listarPlantillas()` descarta
-- los tipos que no existen en esta tabla, así que sin ella la plantilla no
-- aparecería en /admin/notificaciones y nadie podría editarla.
-- ================================================================

alter table public.email_plantillas drop constraint if exists email_plantillas_tipo_check;
alter table public.email_plantillas add constraint email_plantillas_tipo_check check (tipo in (
  'diagnostico_cita', 'bienvenida', 'password_reset', 'respuesta_soporte',
  'confirmacion_pago', 'reactivacion', 'recordatorio_pago', 'fin_prueba',
  'suspension', 'periodo_gracia'
));

-- `do nothing`: si alguien ya la editó desde el admin, esta migración no la pisa.
insert into email_plantillas (tipo, asunto, cuerpo) values
(
  'periodo_gracia',
  'Ampliamos tu acceso a CLAUX hasta el {{fecha_fin}}',
  'Hola,

La suscripción de {{empresa}} venció el {{fecha_expiracion}}. Hemos ampliado tu acceso hasta el {{fecha_fin}} para que no interrumpas tu trabajo.

Si necesitas más tiempo o quieres que veamos otra forma de pago, escríbenos.

El equipo de CLAUX'
)
on conflict (tipo) do nothing;

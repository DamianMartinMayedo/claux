-- Registro profesional: el texto que vive en la BD
--
-- El barrido de lenguaje (skills/ui/SKILL.md §5.1) dejó el código entero en
-- registro impersonal, de usted donde el trato directo es inevitable. Pero el
-- texto de estas dos tablas NO vive en el código: la fila de BD manda sobre el
-- default, y se edita desde /admin. Sin esta migración el portal habla de una
-- manera y los correos de otra.
--
-- Alcance deliberado: solo `settings.ia_tono` y las 13 plantillas de correo.
-- Las descripciones de `modulos_catalogo` quedan fuera a propósito, pendientes
-- de decisión propia.

-- ── 1. El tono del agente ──────────────────────────────────────────────────
-- Esta fila rellena {{tono}} en INSTRUCCIONES_DEFAULT (src/lib/ia/documentos.ts),
-- tres líneas por encima de «Nunca tutees». Con «cercano» el prompt se peleaba
-- consigo mismo: en español es justo la palabra que empuja al modelo al tuteo.
-- Cambia una palabra; «asesor de confianza» se conserva porque es la parte
-- humana y es mejor que el default en código («como un analista»).
-- El campo lo recorta ia-admin.ts a 80 caracteres: este valor son 50.
UPDATE settings
   SET value = 'profesional y directo, como un asesor de confianza'
 WHERE key = 'ia_tono';

-- ── 2. Las 13 plantillas de correo ─────────────────────────────────────────
-- Mismo texto, misma longitud, misma calidez: cambia el pronombre y se corrigen
-- seis defectos que no eran de registro (concordancia, doble espacio, un asunto
-- que sonaba a reproche y el correo de suspensión, que eran tres líneas para la
-- peor noticia que se le manda a un cliente).
-- Ninguna plantilla usa variables que no estén declaradas en PLANTILLAS_VARS
-- (src/lib/email/variables.ts): render.ts descarta las que no lo estén y se
-- verían literales en el correo.

-- Antes: «Bienvenido a CLAUX, {{empresa}}» — saludaba a la empresa en masculino.
UPDATE email_plantillas SET
  asunto = 'Su cuenta de CLAUX ya está activa — {{empresa}}',
  cuerpo = $txt$Hola {{nombre}},

La cuenta de CLAUX para {{empresa}} ya está lista.

Estos son sus datos de acceso:
Usuario: {{usuario}}
Contraseña temporal: {{password_temporal}}

Acceda aquí: {{link_portal}}

Por seguridad, en el primer acceso le pediremos definir su propia contraseña.

Cualquier duda, aquí estamos.
El equipo de CLAUX$txt$
WHERE tipo = 'bienvenida';

UPDATE email_plantillas SET
  asunto = 'Confirmamos su pago — CLAUX',
  cuerpo = $txt$Hola,

Confirmamos la recepción de su pago de ${{monto}} para {{empresa}}.

La suscripción queda activa hasta el {{fecha_expiracion}}.

Gracias por confiar en CLAUX.
El equipo de CLAUX$txt$
WHERE tipo = 'confirmacion_pago';

-- Antes: «¡Gracias por querer contactar  {{nombre}}!» — doble espacio, faltaba
-- un «con», y es el primer correo que ve alguien que aún no es cliente.
UPDATE email_plantillas SET
  asunto = 'Su diagnóstico de CLAUX, {{nombre}}',
  cuerpo = $txt$Hola {{nombre}},

Gracias por completar el diagnóstico de CLAUX para su negocio.

Ya tenemos una idea de lo que necesita. El siguiente paso es una llamada corta para mostrarle cómo funcionaría CLAUX en su caso concreto.

Reserve su cita aquí: {{link_agenda}}

Quedamos a la espera.
El equipo de CLAUX$txt$
WHERE tipo = 'diagnostico_cita';

UPDATE email_plantillas SET
  asunto = 'Su prueba gratuita de CLAUX está por terminar',
  cuerpo = $txt$Hola,

La prueba gratuita de {{empresa}} termina el {{fecha_expiracion}}.

Para seguir usando CLAUX sin interrupciones, escríbanos y activamos la suscripción.

El equipo de CLAUX$txt$
WHERE tipo = 'fin_prueba';

-- Antes: «Llegaste al tope de…» — sonaba a reproche justo en el momento en que
-- se le propone un nivel mayor. Y el cierre acumulaba tres coloquialismos.
UPDATE email_plantillas SET
  asunto = '{{empresa}} alcanzó el límite de {{concepto}} del nivel {{nivel}}',
  cuerpo = $txt$Hola,

{{empresa}} ha llegado a {{limite}} {{concepto}}, que es lo que incluye el nivel {{nivel}}.

No se ha interrumpido nada: todo lo registrado sigue disponible. Lo único que queda bloqueado es añadir más {{concepto}}, hasta archivar algunos o subir de nivel.

Si necesita más espacio, responda a este correo y lo vemos.

El equipo de CLAUX$txt$
WHERE tipo = 'limite_alcanzado';

UPDATE email_plantillas SET
  asunto = 'Nueva contraseña para su cuenta de CLAUX',
  cuerpo = $txt$Hola {{nombre}},

Se ha generado una nueva contraseña temporal para su cuenta de CLAUX ({{empresa}}).

Usuario: {{usuario}}
Contraseña temporal: {{password_temporal}}

Acceda aquí: {{link_portal}}

En el próximo acceso le pediremos definir su propia contraseña.

El equipo de CLAUX$txt$
WHERE tipo = 'password_reset';

UPDATE email_plantillas SET
  asunto = 'Restablecer la contraseña de CLAUX',
  cuerpo = $txt$Hola,

Hemos recibido una solicitud para restablecer la contraseña de {{usuario}}.

Abra este enlace y defina su nueva contraseña: {{link_reset}}

El enlace caduca en {{minutos}} minutos y solo puede usarse una vez.

Si la solicitud no fue suya, no tiene que hacer nada: su contraseña actual sigue funcionando.

El equipo de CLAUX$txt$
WHERE tipo = 'password_reset_link';

UPDATE email_plantillas SET
  asunto = 'Ampliamos su acceso a CLAUX hasta el {{fecha_fin}}',
  cuerpo = $txt$Hola,

La suscripción de {{empresa}} venció el {{fecha_expiracion}}. Hemos ampliado su acceso hasta el {{fecha_fin}} para no interrumpir el trabajo.

Si necesita más tiempo o prefiere otra forma de pago, escríbanos.

El equipo de CLAUX$txt$
WHERE tipo = 'periodo_gracia';

UPDATE email_plantillas SET
  asunto = 'Su cuenta de CLAUX está activa de nuevo',
  cuerpo = $txt$Hola,

Confirmamos su pago: la cuenta de {{empresa}} está activa de nuevo.

Ya puede volver a usar CLAUX con normalidad.

El equipo de CLAUX$txt$
WHERE tipo = 'reactivacion';

UPDATE email_plantillas SET
  asunto = 'Su suscripción de CLAUX vence pronto',
  cuerpo = $txt$Hola,

La suscripción de {{empresa}} vence en {{dias}} días (el {{fecha_expiracion}}).

Para evitar interrupciones, realice el pago antes de esa fecha.

El equipo de CLAUX$txt$
WHERE tipo = 'recordatorio_pago';

UPDATE email_plantillas SET
  asunto = 'Respuesta a su mensaje de soporte',
  cuerpo = $txt$Hola {{nombre}},

Sobre su mensaje «{{asunto}}»:

{{mensaje_admin}}

Si necesita algo más, responda a este correo.

El equipo de CLAUX$txt$
WHERE tipo = 'respuesta_soporte';

UPDATE email_plantillas SET
  asunto = 'Socio CLAUX hasta el {{fecha_fin}}',
  cuerpo = $txt$Hola,

{{empresa}} continúa como Socio CLAUX hasta el {{fecha_fin}}. El portal no cambia en nada y no se genera ningún cobro.

El equipo de CLAUX$txt$
WHERE tipo = 'socio_ampliado';

-- El único que se alarga, y a propósito. Suspender no borra nada (el barrido
-- solo escribe estado = DESACTIVADO en `clients`), y esa es exactamente la duda
-- que tiene quien lo recibe. La pantalla de bloqueo del portal ya se lo dice
-- («los datos siguen intactos»); el correo que la anuncia, no.
UPDATE email_plantillas SET
  asunto = 'Su cuenta de CLAUX ha quedado suspendida',
  cuerpo = $txt$Hola,

La suscripción de {{empresa}} venció y la cuenta ha quedado suspendida. El acceso al portal está cerrado, pero los datos siguen intactos: no se ha borrado nada y, al renovar, todo continúa donde estaba.

Para reactivarla, responda a este correo.

El equipo de CLAUX$txt$
WHERE tipo = 'suspension';

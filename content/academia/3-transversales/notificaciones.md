# Notificaciones

> Pieza transversal · **no se contrata ni se cobra aparte**: está desde el primer día ·
> Campana de la cabecera → Notificaciones

Es lo que convierte al portal en algo que avisa, en vez de algo que hay que ir a mirar. El punto
**6 es el corazón de la ficha**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**CLAUX avisa solo de lo que el negocio tiene que atender —un cobro vencido, un contrato que
caduca, mercancía bajo mínimos, una caja sin cerrar— y retira el aviso cuando el motivo deja de
existir.**

### 2. Para quién
> etiquetas: usar · básico

Para el dueño y para quien lleva la administración. Es la pieza que más se agradece en negocios
donde una sola persona vigila varios frentes a la vez y no puede permitirse recordarlas todas.

### 3. El problema que resuelve
> etiquetas: usar · básico

Los problemas de un negocio pequeño casi nunca son sorpresas: son hechos que se sabían y se
olvidaron. El contrato que vencía este mes, el cliente que lleva sesenta días sin pagar, la caja
que se quedó abierta el viernes. Ninguno de esos datos falta en el sistema; lo que falta es que
alguien los mire el día que tocan. Notificaciones cubre exactamente ese hueco: el portal recorre
cada día lo que tiene guardado, compara contra fechas y umbrales, y solo levanta la mano cuando
hay algo que decidir. Y como el aviso se retira solo al resolverse el motivo, la bandeja no se
convierte en otra lista que mantener.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

El aviso nace de un hecho, no de que alguien lo escriba.

```claux:flujo
```

**Se generan solos.** Cada madrugada el portal revisa vencimientos, umbrales y fechas de todos los
módulos contratados; otros avisos saltan en el momento —una reserva que entra, un pago
confirmado—. El repertorio no es genérico: son **45 tipos de aviso** repartidos en diez áreas, y el
peso está donde está el dinero —la docena de finanzas (cobros y pagos por vencer o vencidos,
facturas de borrador estancadas, ofertas por caducar, la caja sin cerrar o sin contabilizar), ocho
de reservas, siete de la propia suscripción, seis de personal (contratos que vencen, la nómina del
mes sin hacer), y los de existencias, servicios, clientes y proveedores, catálogo y equipo—. **Tres niveles, según lo que pueda esperar.** *Informativo* espera en la campana;
*aviso* salta en una tarjeta arriba a la derecha que se cierra sola; *urgente* es rojo, no se va
solo y vuelve a aparecer hasta que se atienda. **Los vencimientos escalan.** A treinta, quince y
cinco días es un aviso; el último día y ya vencido, urgente. Cada escalón es un aviso distinto y
**no se repite**: la revisión de la madrugada siguiente reconoce el que ya existe en vez de
apilar otro igual, de modo que una factura que tarda un mes en cobrarse produce cuatro avisos, no
treinta.

**Los umbrales están fijados donde dejan de ser normales.** Una caja lleva **más de dieciocho
horas** abierta y ya no es una jornada larga, es un olvido; una reserva sin responder **más de
doce horas** es una respuesta que el cliente no está recibiendo; a partir del **día 25** se espera
tener hecha la nómina del mes; un dossier publicado hace más de **45 días** enseña unos números
que conviene refrescar. **Se resuelve solo.** Cuando la
factura se cobra o el contrato se renueva, el aviso se archiva sin que nadie lo cierre. **Bandeja
del negocio, no de cada persona.** Lo que uno marca como leído lo ven todos: la bandeja es la cola
de trabajo del negocio. **Se puede elegir qué se avisa.** En Preferencias se activa o desactiva
cada tipo y se puede **subir o bajar su nivel**, si para este negocio en concreto algo pesa más o
menos de lo que pesa por defecto. La lista solo enseña los avisos que de verdad pueden llegar:
ofrecer el interruptor de uno que nunca se dispara sería mentir. **Se limpia sola.** Lo leído y lo archivado de más de tres meses desaparece.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

- **Solo avisa de lo que el negocio tiene contratado.** Cada tipo de aviso pertenece a un módulo;
  sin el módulo, el aviso no se genera. No hay avisos de mercancía en un negocio sin inventario.
- **El aviso vive mientras vive el motivo.** No se «cierra»: se resuelve. Cerrar a mano lo que
  sigue pendiente sería una forma de perderlo.
- **La urgencia se gradúa, no se declara.** Un cobro a treinta días y uno vencido no son el mismo
  aviso; si todo fuera urgente, nada lo sería.
- **Es interno, no sale del portal.** Estos avisos son del negocio para el negocio: no se envían
  por correo ni llegan al cliente final. Lo único que CLAUX manda por correo es lo relativo a la
  propia suscripción.
- **La bandeja no puede mentir.** Cada revisión no se limita a crear avisos nuevos: comprueba
  también qué **sigue** cumpliendo la condición hoy, y archiva lo que ya no. Un aviso que se queda
  encendido después de resuelto enseña al dueño a ignorar la campana entera, y a partir de ahí el
  módulo no sirve para nada.
- **Reservas y Citas se avisan por separado.** Son dos módulos que se venden aparte y casi nunca
  coinciden en el mismo negocio; juntarlos en una sola categoría obligaría a una peluquería a
  filtrar por una palabra que no usa.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Notificaciones no tiene datos propios: vive de lo que los demás módulos guardan. Cada módulo
contratado le añade su repertorio de avisos.

```claux:conexiones
```

Funciona sin haber contratado nada —los avisos de la propia suscripción a CLAUX llegan siempre—,
y crece con cada módulo que se activa. La relación es literal: cada tipo de aviso declara de qué
módulo depende, y el que no se tiene contratado **no se genera nunca**, ni siquiera oculto. Unos
pocos avisos aceptan **varios módulos**, en el sentido de que basta con tener uno: el resumen del
día sirve igual al negocio que lleva Reservas que al que lleva Citas. Por eso activar un módulo
nuevo no exige configurar nada aquí —su repertorio de avisos aparece solo— y darlo de baja
tampoco deja avisos huérfanos.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. La **campana** de la cabecera lleva la cuenta de lo que hay sin leer.
2. **Notificaciones** abre la bandeja completa, con el detalle de cada aviso y el enlace al sitio
   donde se resuelve.
3. En **Preferencias** se decide qué se avisa y qué no. Conviene revisarlas una vez al principio y
   no volver a tocarlas.
4. La rutina es la misma que la del Dashboard: mirar la campana por la mañana y atender de arriba
   abajo.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «No hace falta acordarse de nada. El sistema le avisa el día que un cliente se pasa
de plazo, que un contrato vence o que se está quedando sin mercancía.»

Es un argumento **de tranquilidad**, y funciona mejor cuando se ancla a un caso que el dueño haya
vivido. Conviene preguntarle si alguna vez se le pasó un cobro o un contrato: la respuesta suele
vender la pieza sola.

**Demo (breve, se enseña al pasar por el Dashboard):**
1. Abrir la **campana** y leer dos avisos reales.
2. Pulsar uno y llegar directo al documento que lo origina.
3. Enseñar **Preferencias** para dejar claro que el dueño decide de qué se le avisa.

**Objeciones:**
- *«No quiero que me llenen el teléfono de mensajes.»* → No hay mensajes. Es dentro del portal, y
  se elige de qué avisar.
- *«¿Y si somos varios mirando lo mismo?»* → La bandeja es del negocio: lo que uno atiende, los
  demás lo ven atendido.
- *«Me va a llenar la pantalla de alertas rojas.»* → El rojo se reserva para lo vencido o lo del
  último día; el resto espera en la campana.

### 9. Precio y activación
> etiquetas: vender · básico

- **Sin coste adicional.** No es un módulo ni un addon, y no aparece en la factura de CLAUX.
- **No se activa:** está desde el primer día. Lo que crece es **de cuántas cosas avisa**, según los
  módulos contratados.
- Es un buen cierre de demostración: resume el argumento de que CLAUX no es un archivo donde
  guardar datos, sino un sistema que trabaja cuando nadie lo está mirando.

---

### Alcance honesto
> etiquetas: vender · básico

- La bandeja del portal la ve el **administrador del negocio**. Un usuario con acceso limitado no
  tiene bandeja propia.
- Los avisos son **internos y no salen por correo**. El envío de un resumen por correo está
  contemplado pero no construido.
- El repertorio describe más avisos de los que hoy se disparan; en **Preferencias solo aparece lo
  que de verdad funciona**, para no ofrecer lo que no existe.
- **Pendiente:** el aviso de caducidad de mercancía. Exige llevar lotes, y una fecha suelta en el
  producto miente en cuanto el negocio repone.
- La campana **se refresca al volver a la pestaña**, no al instante. Es una decisión técnica
  deliberada; en la práctica no se nota, porque estos avisos son de días, no de segundos.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No me llega ningún aviso.»** → Comprobar tres cosas en este orden: que el usuario sea el
  administrador del negocio, que el módulo esté contratado y que el tipo esté activo en
  Preferencias.
- **«Me avisa de algo que ya resolví.»** → Los avisos que se generan cada madrugada se retiran en
  la pasada siguiente. Si persiste al día siguiente, el motivo sigue vivo en el módulo.
- **«Amanecí con diez tarjetas.»** → Cuando hay muchos avisos a la vez se resumen en uno solo; el
  detalle está en la bandeja.
- **«Desaparecieron avisos viejos.»** → Lo leído y archivado de más de tres meses se purga. Es
  histórico, no pendiente.
- **«Esperaba un correo.»** → Estos avisos no se envían por correo por diseño. Por correo solo
  salen los asuntos de la suscripción a CLAUX.

# Reservas

> Funcionalidad del catálogo (clave interna `reservas_citas`) · en el portal: **Reservas**
> (`/portal/reservas`) · página pública `/tu-negocio/reservar` ·
> con bot de Telegram propio

Funcionalidad de un solo dominio: el punto **4 es un «Qué hace» único**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**Reservas permite al cliente apartar sitio en línea —una mesa, una plaza en una clase, una
franja de pista— dentro del aforo definido para cada franja**, de modo que el negocio ni se
sobrevende ni se queda con capacidad ociosa por no haber podido atender el teléfono.

### 2. Para quién
> etiquetas: usar · básico

Para negocios que operan **por aforo y por franja horaria**: restaurantes con turnos de mesa,
gimnasios y academias con plazas por clase, canchas y pistas por tramo de uso. Lo que se aparta
aquí es **capacidad**, no el tiempo de una persona concreta.

> **No confundir con Citas.** *Reservas* administra **aforo por franja** —una mesa de cuatro,
> cuarenta plazas en una clase—. *Citas* asigna **una cita por profesional y hueco** —un barbero,
> un médico, una hora—. Son funcionalidades distintas, se venden por separado, y un mismo negocio
> puede tener ambas.

### 3. El problema que resuelve
> etiquetas: usar · básico

Gestionar el aforo por teléfono produce pérdidas en las dos direcciones a la vez. Por un lado, la
sobreventa: dos anotaciones sobre la misma mesa que solo se detectan cuando ambos clientes se
presentan, con un coste reputacional que ninguna disculpa compensa. Por otro, la capacidad
desaprovechada: la demanda que llega fuera de horario —de noche, en fin de semana, mientras se
está atendiendo— no encuentra a nadie al otro lado y se dirige a otro sitio. Reservas cierra las
dos brechas con el mismo mecanismo: el cliente **aparta por sí mismo, a cualquier hora, y
únicamente si queda sitio real** en esa franja.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

La funcionalidad se construye sobre una sola magnitud —la capacidad de cada franja— y todo lo
demás la respeta.

```claux:flujo
```

La **página pública de reserva** guía al cliente por día, franja y número de personas, muestra la
**disponibilidad real** con atajos «Hoy» y «Mañana», recoge su **teléfono** —obligatorio— y un
correo opcional, y cierra con una revisión antes de confirmar; está optimizada para que reservar
cueste el mínimo de toques posible. El **panel del portal** presenta el listado de reservas con
filtros por estado y fecha y su buscador: desde ahí se **confirma o rechaza**, se registra quién
no se presentó y se da de alta una reserva **a mano**. El **aforo por franja** se define
explícitamente —cuarenta plazas no equivalen a diez mesas de cuatro— y CLAUX impide apartar por
encima de él; también se marcan **festivos y cierres** del negocio. Las **reglas de reserva**
—antelación mínima, ventana de reserva, aforo— rigen con independencia del canal de entrada.
Completa el conjunto un **bot de Telegram propio**, de botones, que pregunta personas → día →
hora y solo ofrece franjas con hueco efectivo.

**La franja tiene dos topes, no uno.** Se define la **capacidad en personas** y, aparte, el
**número máximo de reservas simultáneas** —cuarenta plazas y diez mesas son dos límites distintos, y
el negocio puede quedarse sin mesas mucho antes que sin sillas—. Cada franja lleva además su
**duración** y los **días de la semana** en que rige, de modo que el horario de fin de semana no
tiene que ser el de diario, y puede **desactivarse** sin borrarla cuando deja de usarse una
temporada.

**El panel mira hacia delante.** El listado se abre en **los próximos treinta días**, no en el
historial: una reserva es un documento de futuro, y lo que el negocio necesita ver al entrar es lo
que tiene que atender. Sobre esa lista, la cabecera cuenta **lo de hoy** por separado —pendientes,
confirmadas y total— aunque se cambie el rango consultado, y avisa de las reservas **por cerrar**:
las de días ya pasados que nadie marcó ni como atendidas ni como ausencias. Las reservas pueden
además **tratarse en lote**: seleccionar varias y confirmarlas o rechazarlas de una vez, avisando a
cada cliente igual que si se hubieran tocado una a una.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cinco reglas gobiernan la funcionalidad:

- **Tres puertas, una sola regla.** Una reserva entra por la **web pública**, por el **bot de
  Telegram** o **a mano** desde el panel, y las tres atraviesan el mismo control de aforo y las
  mismas reglas.
- **No existe la sobreventa.** El aforo se bloquea efectivamente al confirmar: dos clientes no
  pueden quedarse simultáneamente con la última plaza, aunque pulsen a la vez.
- **La vida de una reserva son sus estados.** Son siete: nace **pendiente** o **confirmada** según
  el ajuste, y termina en **atendida**, **no asistió**, **cancelada**, **rechazada** o
  **caducada**. No todas las transiciones existen: de confirmada se pasa a atendida, a ausencia o a
  cancelada, y nunca al revés. Lo que sí se puede es **deshacer** —devolver a pendiente algo
  cancelado o rechazado por error—, pero solo si la fecha no ha pasado y **la plaza sigue libre**:
  deshacer no puede pisar a otro cliente que ocupó el hueco entretanto.
- **El pasado se cierra solo, y se dice quién lo cerró.** Una pendiente que venció sin que nadie la
  atendiera se marca **caducada** sola; una confirmada de un día pasado que nadie cerró pasa a
  **atendida** a los siete días. En pantalla queda constancia de que ese cierre lo hizo el sistema y
  no el negocio, para que nadie lo lea como un dato comprobado.
- **El dueño puede forzar; el cliente, nunca.** Desde el alta manual el negocio puede saltarse
  una regla: **se advierte, no se bloquea**, y la reserva queda señalada como forzada. Desde la
  web o el bot esa posibilidad no existe.
- **Al cliente se le escribe lo que le sirve, no lo que le juzga.** Quien reservó por Telegram
  recibe aviso al confirmarse, rechazarse o cancelarse su reserva. «No asistió», «atendida» y
  «caducada» son anotaciones internas del negocio y **no generan ningún mensaje**: a nadie se le
  escribe para decirle que no vino.
- **Todo se calcula en la hora del negocio.** El «hoy» y las franjas los determina el servidor en
  la zona horaria del negocio, no el dispositivo de quien reserva: la última franja de la noche
  sigue siendo de hoy aunque el cliente esté en otro huso.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Reservas comparte con las demás piezas públicas aquello que pertenece al negocio —su dirección,
sus cierres, sus reglas— y no depende de ningún módulo interno.

```claux:conexiones
```

La funcionalidad **se vende y funciona sola**. El addon de IA no la habilita: solo cambia el modo
de conversar del bot, que sin él opera perfectamente con botones.

Lo que comparte con **Citas** no es casualidad ni ahorro de trabajo: la **dirección web**, los
**días de cierre** y las **reglas de antelación y ventana** son del negocio, no de una funcionalidad
concreta. Un negocio que cierre el lunes lo cierra para todo, y sería absurdo tener que declararlo
dos veces. Lo que sí es propio de Reservas —las franjas, su aforo, su bot— no lo ve Citas. Cuando el
negocio tiene las dos contratadas, cada ajuste dice de cuál de las dos es; con una sola, esa
distinción es ruido y no se muestra.

Hacia fuera aporta dos señales: al **Dashboard**, lo que ocurre hoy y la próxima reserva; a
**Notificaciones**, las que llevan demasiado tiempo sin confirmar. Hacia dentro no escribe en
ningún módulo: **una reserva no es una venta** y no genera factura, ni cobro, ni movimiento
contable. Lo que se cobre de esa mesa se cobra después, en el Punto de venta o en Contabilidad, sin
que CLAUX intente adivinar la relación entre ambas cosas.

```claux:capas
```

### 7. Cómo se usa (paso a paso)
> etiquetas: usar · básico

1. **Fijar la dirección web** y definir las **franjas** con su **aforo**.
2. Marcar los **días de cierre** y las **reglas** —antelación y ventana—.
3. **Elegir el modo de confirmación**: automática o una a una.
4. *(Opcional)* **Conectar el bot de Telegram**.
5. **Compartir el enlace o colocar el QR**. Las reservas entran en el panel.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Que sus clientes aparten mesa solos, a cualquier hora, sin llamar — y sin que se
sobrevenda el sábado.»

**Demo:**
1. Abrir el **enlace público** en el móvil: elegir personas, día y franja, señalando que **solo
   aparecen las franjas con hueco**.
2. Dejar un teléfono y **confirmar**: la reserva ya figura en el panel.
3. Mostrar cómo se **rechaza** una y cómo se **marca un cierre** del negocio.
4. Enseñar el **bot** de Telegram.

**Objeciones:**
- *«Lo llevo en una libreta.»* → La libreta no atiende de madrugada ni evita el doble apunte, y
  obliga al cliente a llamar para poder reservar.
- *«Prefiero el teléfono.»* → El teléfono sigue funcionando igual; esto captura lo que hoy se
  pierde fuera de horario.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **Funciona sola:** no exige ningún otro módulo.

---

### Alcance honesto
> etiquetas: vender · básico

CLAUX **no escribe por correo al cliente final**, y la WhatsApp Business API no admite números
+53. La única vía automática de vuelta es **Telegram, y solo hacia quien reservó por el bot**: ese
cliente recibe aviso cuando su reserva se confirma, se rechaza o se cancela. Quien reservó por la
web pública no recibe nada; su canal es el **enlace de gestión** para cancelar, más el dueño con un
botón. La **vista de día** y la **lista de espera** siguen en backlog. No deben prometerse
recordatorios automáticos por SMS ni por WhatsApp.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No aparecen huecos en el enlace.»** → Falta definir el **aforo** de las franjas, o ese día
  está marcado como **cierre**.
- **«El bot no responde o no avisa.»** → Configuración › Bot › **Comprobar** y, si procede,
  **Reparar**; comprobar que el **chat del dueño esté vinculado**. Existe **aviso de prueba**.
- **«El bot siguió tomando reservas tras dejar de pagar la funcionalidad.»** → Ya resuelto: el
  bot respeta el candado comercial.
- **«Se sobrevendió una franja.»** → No debería ocurrir: el aforo se bloquea al confirmar.
  Conviene revisar si esa reserva se introdujo **forzada** a mano, en cuyo caso queda marcada
  como tal.

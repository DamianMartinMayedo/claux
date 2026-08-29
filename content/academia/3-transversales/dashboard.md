# Dashboard

> Pieza transversal · **no se contrata ni se cobra aparte**: está desde el primer día ·
> Menú lateral → Inicio

Es la primera pantalla que ve el dueño cada mañana y, para muchos, la única que abre si el día
viene bien. Su trabajo no es enseñarlo todo, sino enseñar lo que exige una decisión. El punto **6
es el corazón de la ficha**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**El Dashboard reúne en una sola pantalla lo que el negocio tiene pendiente hoy, cómo va el
dinero, qué pasa durante el día y en qué estado está el negocio, tomándolo de los módulos que
estén contratados.**

### 2. Para quién
> etiquetas: usar · básico

Para el dueño, principalmente. Es la pantalla de quien no va a entrar módulo por módulo: quiere
abrir el portal, mirar treinta segundos y saber si hay algo que atender. También sirve al
encargado, que ve la misma pantalla recortada a lo que su acceso le permite.

### 3. El problema que resuelve
> etiquetas: usar · básico

Un sistema de gestión completo tiene el defecto de que la información está bien guardada y mal
disponible: para saber si hay un cobro vencido hay que entrar en cobros, para saber si falta
mercancía hay que entrar en inventario, y para saber si la caja quedó abierta hay que acordarse de
mirar. El resultado es que el dueño se entera de los problemas tarde, no porque el dato no
estuviera, sino porque nadie fue a buscarlo. El Dashboard invierte esa relación: lo accionable
sale a la superficie sin que nadie lo pida, agrupado por urgencia y no por módulo, de modo que la
primera pantalla del día ya contiene la lista de lo que hay que decidir.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

La pantalla está organizada en cuatro zonas, ordenadas de lo urgente a lo general.

```claux:flujo
```

**Pendiente.** Una franja arriba con lo accionable de todos los módulos junto: un cobro vencido,
una caja sin cerrar, una reserva sin confirmar. No es un resumen: es una lista de tareas pendientes.
**Tu dinero.** Cómo va el negocio en el mes, qué hay que cobrar y qué hay que pagar, y con qué
tasas de cambio se están convirtiendo esas cifras —con el botón de actualizarlas ahí mismo—. **Tu
día.** Lo que ocurre hoy: reservas, citas y lo que lleva cobrado el mostrador. **Tu negocio.** Lo
que se mueve despacio y conviene vigilar: existencias, personal, acuerdos recurrentes, catálogo y
dossier. **Encabezado con contexto.** El nombre del negocio, la fecha larga, las empresas —cada
una con su color— y, a la derecha, tres etiquetas: el **nivel** contratado, el **estado** de la
suscripción y —solo si lo es— **Socio CLAUX**. **Y qué falta por hacer.** Si el negocio
aún no ha creado su empresa o configurado una moneda, la pantalla lo pide antes que ninguna otra
cosa, porque sin eso no se puede operar.

**Qué llega a «Pendiente».** La franja no es una selección editorial: cada módulo aporta sus líneas
y todas se escriben igual —el número, qué ocurre y adónde ir a resolverlo—. Hoy se vigilan once
situaciones: dinero vencido por cobrar y por pagar, productos bajo mínimo, puntos de venta sin
sincronizar, salidas de efectivo del mostrador sin clasificar, dossiers publicados con números
viejos, nóminas sin confirmar, contratos que terminan dentro de treinta días, artículos de la carta
sin foto o sin precio, suscripciones que renuevan dentro de treinta días y documentos legales sin
firmar. Cada línea lleva uno de dos tonos: **alerta** cuando ya duele —está vencido, ya falta
mercancía, la caja ya está descuadrada— y **aviso** cuando conviene mirarlo antes de que duela. Las
alertas se colocan primero; dentro de la franja el orden no depende del módulo del que vengan.

Dos decisiones dan forma a esa lista. La primera: **una línea por asunto, no una por moneda**. Un
negocio que opera en tres monedas produciría seis avisos diciendo dos veces lo mismo, así que los
importes vencidos se agrupan en una sola frase. La segunda: **la línea lleva a donde se resuelve**,
no a la portada del módulo — «3 productos bajo mínimo» abre la lista de productos ya filtrada por
los que faltan, no el inventario entero.

**Lo que el negocio aún no tiene.** Al pie, la pantalla ofrece los módulos no contratados, cada uno
con una frase de para qué sirve: el nombre por sí solo no explica qué problema resuelve. El orden lo
decide el catálogo comercial, no esta pantalla, y los complementos que amplían otro módulo no se
ofrecen mientras falte el módulo que amplían. Si el dueño ya pidió activar algo, la oferta lo
recuerda con la fecha en que lo pidió en lugar de insistir como si fuera la primera vez.

Entre esas ofertas hay una que **no es un módulo: subir de nivel**. Sale cuando al negocio se le
está llenando algo —empresas, productos, plantilla, cualquiera de los topes— y no antes: ofrecer
más sitio a quien le sobra es ruido. La señal no la calcula esta pantalla, la trae ya escrita el
aviso que dejó el escáner al pasar del 90 %, porque el dashboard es lo primero que se abre cada
mañana y no puede ponerse a contar productos y empleados en cada carga. Para quien vende, es el
único aviso de la pantalla que **no** se resuelve contratando: se resuelve hablando.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

- **Solo se enseña lo que existe.** Cada tarjeta pertenece a un módulo: si el módulo no está
  contratado, la tarjeta no aparece —ni vacía, ni en gris, ni «para contratar»—. Un negocio con
  dos módulos ve dos tarjetas y la pantalla sigue teniendo sentido.
- **Lo urgente va junto, no repartido.** «Pendiente» cruza módulos a propósito: quien mira esa
  franja no está pensando en qué módulo vive cada cosa, está decidiendo qué hacer primero.
- **Un módulo nuevo añade una línea, no otra tarjeta.** Es la regla que mantiene la pantalla
  acotada: si cada funcionalidad reclamara su propio recuadro, el dashboard crecería hasta dejar de
  responder la única pregunta que se le hace por la mañana.
- **Las cifras son de lectura; se actúa donde toca.** Cada tarjeta lleva al sitio donde se resuelve
  lo que enseña. La excepción deliberada es la actualización de tasas, que se hace desde aquí.
- **Lo que ya se decidió no es un pendiente.** Un artículo marcado como agotado no genera aviso —es
  una decisión del dueño, no un descuido—; uno sin precio, sí. La franja recoge olvidos, no
  decisiones.
- **Cada cosa se le pide a quien puede hacerla.** Los pasos de configuración inicial y la firma de
  documentos solo se le muestran al administrador de la empresa, que es quien puede resolverlos.
  Avisar al resto sería ruido sin salida.
- **Habla el idioma del negocio.** Las líneas usan el vocabulario del sector: la misma situación se
  lee «En tu menú: 3 sin foto» en un restaurante y «En tu catálogo» en una tienda.
- **El color de los iconos informa.** Dentro de cada zona no se repite: el mismo color en dos
  tarjetas vecinas dejaría de distinguirlas de un vistazo.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

El Dashboard es el único sitio del portal que lee de todos los módulos a la vez. No produce
información propia: la presenta.

```claux:conexiones
```

Existe desde el primer día, con o sin módulos. Mientras no haya ningún panel que enseñar, la
pantalla cumple otra función: guía los primeros pasos, ofrece accesos rápidos y señala qué más
puede activar el negocio.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Es la pantalla de entrada: se llega a ella al iniciar sesión, y desde **Inicio** en el menú
   lateral.
2. Al principio pedirá lo imprescindible: **crear la empresa** y **configurar una moneda**.
3. A medida que se activan módulos, sus tarjetas van apareciendo solas en la zona que les
   corresponde.
4. La rutina recomendada al dueño es simple: mirar **Pendiente** cada mañana y, desde ahí, entrar
   solo a lo que haya que resolver.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Abra CLAUX por la mañana y en treinta segundos sabe qué tiene que hacer hoy: qué
le deben, qué debe usted, qué falta en el almacén y qué pasa en el local.»

El Dashboard es **la primera pantalla de toda demostración** y la que más decide. Conviene abrirla
con datos, aunque sean pocos: una pantalla vacía no vende nada, y una con tres tarjetas reales
vende más que un recorrido por diez módulos.

**Demo (es el arranque natural de la visita):**
1. Abrir el portal y detenerse en la franja **Pendiente**: leer en voz alta dos o tres líneas.
2. Bajar a **Tu dinero** y enseñar el resultado del mes y las deudas.
3. Pulsar en una tarjeta para mostrar que **lleva al sitio donde se resuelve**.
4. Cerrar señalando las zonas vacías: «esto se irá llenando con lo que usted vaya activando».

**Objeciones:**
- *«Esto es mucha información.»* → Solo aparece lo que se contrata. Un negocio con contabilidad y
  nada más ve una pantalla corta.
- *«¿Y si tengo varias empresas?»* → El encabezado enseña todas, cada una con su color, y las
  cifras pueden leerse por empresa o en conjunto.
- *«Mis empleados no deberían ver esto.»* → Cada usuario ve su versión: lo que su acceso permite,
  ni una tarjeta más.

### 9. Precio y activación
> etiquetas: vender · básico

- **Sin coste adicional.** No es un módulo ni un addon, y no aparece en la factura de CLAUX.
- **No se activa:** está desde el primer día. Lo que cambia con el tiempo es **cuánto enseña**, que
  depende de los módulos contratados.
- Es, por eso, la mejor demostración del modelo de CLAUX: el negocio empieza con lo que necesita y
  la pantalla crece con él.

---

### Alcance honesto
> etiquetas: vender · básico

- Es una pantalla **de lectura**. Salvo la actualización de tasas, no se opera desde aquí: se
  entra al módulo.
- Las cifras consolidadas se expresan en la **moneda de consolidación** y convierten a la tasa
  vigente lo que no esté en ella. Es una vista de referencia, no un estado contable formal.
- La sugerencia de **qué más se puede activar** tiene en cuenta lo que el negocio ya contrató y lo
  que ya pidió: no insiste con lo mismo.
- Un negocio recién creado ve una pantalla **casi vacía a propósito**, con los pasos de
  configuración en primer plano. Conviene avisarlo en la demostración con datos de prueba.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No veo la tarjeta de un módulo que tengo contratado.»** → Comprobar el **acceso del usuario**:
  cada uno ve solo lo que su permiso alcanza. Después, que el módulo tenga datos.
- **«El resultado del mes no cuadra.»** → Suele ser conversión de moneda o el período: la tarjeta
  habla del mes en curso.
- **«Las tasas salen en ámbar.»** → Es el aviso de tasa vieja: más de quince días sin
  actualizarse. Se resuelve desde la propia tarjeta.
- **«Me pide crear empresa y ya la tengo.»** → El aviso solo se retira cuando la empresa está
  guardada; conviene comprobar que se completó el alta.
- **«La pantalla está vacía.»** → O el negocio no tiene módulos contratados todavía, o el usuario
  no tiene acceso a ninguno.

# Punto de venta

> Módulo (clave interna `caja`) · en el portal: **Punto de venta**, un grupo de **4 páginas**
> (Puntos de venta, Operaciones, Cierres, Sincronizar) · la caja
> es una **app que funciona sin conexión** y sincroniza con CLAUX

Módulo de dos caras: la **app de caja** —una web instalable en el móvil o la tablet del
mostrador, operativa **sin internet**— y el **panel** del portal, donde el dueño consulta lo
vendido. El punto **4 recorre la app y las cuatro páginas del panel**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**El Punto de venta es la caja del mostrador: cobra desde un móvil o una tablet, sigue
funcionando aunque caiga internet y, al cerrar el turno, traslada a CLAUX las ventas, el arqueo
y la mercancía que salió** — sin que nadie tenga que transcribir nada.

### 2. Para quién
> etiquetas: usar · básico

Para cualquier negocio que **cobre en un mostrador**: cafeterías, quioscos, comercios, puntos
de venta ambulantes, ferias y ventas a domicilio. **La conexión deja de ser un requisito para
vender**: la caja solo la necesita para sincronizar, y ese momento lo elige el negocio.

### 3. El problema que resuelve
> etiquetas: usar · básico

Un terminal convencional convierte un corte de conexión en una parada de la actividad: sin línea
no se cobra, y el negocio se detiene en el peor momento posible, con el cliente delante. La
alternativa habitual —la libreta— traslada el problema al final del día: al cierre nadie puede
determinar si el cajón cuadra, porque no hay contra qué contrastarla, y lo vendido nunca llega
al informe salvo que alguien lo teclee otra vez. El Punto de venta resuelve ambas: **cobra sin
conexión**, calcula el **arqueo** del turno y, al cerrar, deposita el resultado completo en la
contabilidad en un único envío.

---

## B — Cómo funciona

### 4. Qué hace — la app y las cuatro páginas del panel
> etiquetas: usar · básico

El ciclo del módulo es el turno, y no la venta individual: es la unidad que se abre, se opera, se
cuadra y se transmite.

```claux:flujo
```

**La app de caja**, instalada en el aparato del mostrador. Se despliega mediante un **enlace o un
código QR** generado en la configuración del punto. Es una **web instalable** que **almacena todo
en el propio dispositivo**: abre y cobra **sin internet**. Ofrece rejilla de productos, carrito,
cálculo del cambio, **medios de pago** y **tema oscuro** para el turno de noche, con una
disposición pensada para el mostrador —botones amplios, uso a una mano, aprovechamiento del móvil
en horizontal—. El turno se abre con un **fondo inicial**; durante la jornada se cobra y se
registran las **salidas de efectivo** —pagar a un proveedor con el efectivo del cajón—; al cerrar se practica
el **arqueo**: efectivo esperado = fondo + ventas en efectivo + entradas − salidas, con el
**descuadre** a la vista antes de confirmar el cierre.

**Puntos de venta** es la configuración: cada caja se da de alta indicando qué vende —productos,
servicios o ambos—, a qué cuenta se dirige cada medio de pago, y desde ahí se obtiene su
**enlace y QR** de instalación. El listado refleja la **salud** de cada punto, señalando cuántos
días lleva sin sincronizar.

**Operaciones** muestra lo vendido —**ventas** y **movimientos de stock**— con totales por
moneda, **ticket desplegable** y filtros por estado y medio de pago.

**Cierres** recoge los **turnos cerrados** con su **número Z**. Incluye una pestaña **«Sin
contabilizar»** que lista los turnos aún no incorporados al informe y permite contabilizarlos
**con la fecha del último ticket**, no con la del día en que se procesan.

**Sincronizar** expone el estado de la transmisión: qué queda pendiente, desde cuándo, y un botón
para forzar el envío.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cinco decisiones explican el comportamiento del módulo. Conviene conocerlas porque determinan
qué se puede prometer y qué no:

- **Vende sin conexión y sincroniza al cerrar turno.** El punto de venta no necesita red para
  operar: los tickets se guardan en el dispositivo y suben **en un solo envío al cerrar**, más un
  botón manual para forzarlo cuando convenga. Lo que sustituye a la transmisión continua es la
  **información**: la pantalla de apertura de turno muestra lo que quedó sin subir y desde qué
  fecha, y el portal avisa a los 7, 15 y 30 días.
- **Nada se pierde aunque el aparato se apague.** El turno **abierto** viaja en el mismo envío,
  de modo que unas ventas sin cerrar —se agota la batería, se corta la corriente— no quedan
  fuera de los libros.
- **Solo se marca como enviado lo que CLAUX aceptó.** Si un ticket es rechazado —por ejemplo, una
  moneda que el punto ya no admite—, permanece **pendiente y se reintenta**, en lugar de darse
  por transmitido.
- **El día es el del negocio, no el del reloj UTC.** Una venta de las nueve de la noche computa
  en la jornada correcta, y un cierre del día 31 no se desplaza al mes siguiente.
- **El número Z lo asigna el servidor.** El correlativo auditable no puede generarse en el
  dispositivo, porque dos aparatos lo duplicarían: lo emite CLAUX al recibir el cierre.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

El Punto de venta es un módulo emisor: conserva su propio detalle completo y entrega a los demás
el resultado consolidado de cada turno.

```claux:conexiones
```

La caja **funciona por sí sola** —cobra, arquea y cierra sin ninguna otra pieza contratada—. Lo
que aportan los demás módulos es destino para esa información: sin ellos, el detalle sigue
estando en Operaciones y Cierres.

```claux:capas
```

> Sobre el efectivo del cajón: el dinero que sale de la caja para un gasto se transmite **sin clasificar**, y
> el dueño lo resuelve después, en lote, desde una bandeja. No se le pide una decisión contable a
> quien está atendiendo al cliente.

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Dar de alta el **punto de venta**: qué vende y a qué cuenta va cada medio de pago.
2. **Instalar la app** en el móvil o la tablet mediante su QR.
3. Abrir turno con el **fondo inicial** y **cobrar**, con o sin internet.
4. Al terminar, practicar el **arqueo** y **cerrar** el turno: el envío sube a CLAUX.
5. En el panel, consultar **Operaciones** y **Cierres**; lo vendido ya figura en el informe.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Cobre aunque se vaya internet o la luz. Al cerrar el turno, sus ventas, su arqueo
y su stock llegan solos a CLAUX, sin apuntar nada dos veces.»

**Demo:**
1. **Instalar la app** con el QR en un móvil. Ponerlo en **modo avión** y **cobrar igualmente**.
2. Registrar una **salida de efectivo** —pagar algo con el efectivo del cajón—.
3. **Cerrar el turno** y mostrar el **arqueo** con su descuadre.
4. Restablecer la conexión, **sincronizar**, y comprobar en el portal el cierre con su número Z,
   su ingreso en Tesorería y su salida de stock.

**Objeciones:**
- *«Aquí se cae internet continuamente.»* → Es precisamente el argumento: la caja **no lo
  necesita** para cobrar; solo para subir al cerrar, cuando la jornada ya está controlada.
- *«¿Y si se apaga el móvil con el turno abierto?»* → Las ventas están guardadas en el propio
  aparato y suben en cuanto se sincroniza; el turno abierto, también.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **El nivel también pone el techo de puntos de venta.** Cuántas cajas puede tener dadas de alta
  no lo decide este módulo: lo decide su nivel. (Cuenta la caja como punto de venta, no el turno:
  abrir y cerrar turno cada día no gasta cupo.) Dos locales con caja propia no caben donde cabe
  uno, así que es una pregunta que se hace ANTES de dar un precio, no después.
- **Funciona solo.** Con Contabilidad e Inventario, cada cierre alimenta además el informe y
  descuenta del almacén.

```claux:limites:puntos_venta
Puntos de venta por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

La sincronización es **manual o al cerrar**, por decisión de producto: no existe envío
continuo. **Corregir un ticket ya sincronizado** está en el backlog. La app es
deliberadamente ligera —unos 4 KB— para abrir sin conexión, y por eso no incorpora fotografías de
producto, sino una inicial de color. El **número Z** y el **día del negocio** los determina el
servidor conforme a la **zona horaria del negocio**, no al reloj del teléfono.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«Vendí y no aparece en el informe.»** → Falta **cerrar y sincronizar** el turno, o el cierre
  quedó **sin contabilizar**: pestaña «Sin contabilizar» en Cierres → «Contabilizar».
- **«El saldo de la cuenta de caja está inflado.»** → Las **salidas de efectivo** del turno se
  asientan como egresos; si un cierre antiguo no las trasladó, basta con contabilizarlo.
- **«Un cierre no encuentra una moneda.»** → Esa moneda no tiene **cuenta asignada** en el punto
  de venta; al configurarla, «Contabilizar» completa el cierre.
- **«El icono de la app no abre sin internet.»** → Reinstalar desde el QR —el enlace incorpora la
  credencial—; además, el punto debe haber sembrado sus productos al menos una vez.

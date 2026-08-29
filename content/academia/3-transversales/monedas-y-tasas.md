# Monedas y tasas

> Pieza transversal · **no se contrata ni se cobra aparte**: está desde el primer día ·
> Menú de la cuenta → Monedas y tasas

Un negocio cobra en una moneda, compra en otra y quiere saber cuánto ha ganado en una tercera; y
la tasa con la que se convierte cambia de un día para otro. Esta pieza es la que sostiene esas dos
cosas en todo el portal. El punto **6 es el corazón de la ficha**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**CLAUX trabaja con todas las monedas del negocio a la vez —peso, MLC, dólar, euro—, mantiene al
día la tasa de cada una sin que nadie la teclee, y presenta el total en la moneda que el dueño
elija.**

### 2. Para quién
> etiquetas: usar · básico

Para cualquier negocio que toque más de una moneda, que en la práctica son casi todos. No es una
pieza para el que exporta: es para el que cobra en una moneda, compra en otra y paga a un proveedor
en una tercera. Un negocio que hoy solo maneja pesos también la usa, aunque no lo
note, porque es la que fija en qué moneda está cada cifra del sistema.

### 3. El problema que resuelve
> etiquetas: usar · básico

El negocio opera de facto en varias monedas, pero la herramienta con la que se lleva —una hoja de
cálculo, una libreta— solo entiende números. La consecuencia no es incomodidad, es que
las cifras dejan de ser comparables: se suman pesos con dólares, se aplica «la tasa» de memoria o
la que alguien recuerda del grupo de Telegram, y el resultado del mes depende de con qué número
se hizo la cuenta. Además, esa tasa envejece: en un mercado que se mueve, una tasa de hace tres
semanas convierte mal cualquier importe que toque. Monedas y tasas resuelve las dos cosas: cada
importe conserva la moneda en la que ocurrió de verdad, y la conversión se hace con una tasa
fechada, actualizada sola y visible, no con un número de memoria.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

La pieza gestiona tres cosas encadenadas: qué monedas usa el negocio, a qué tasa se cambian entre
sí, y en cuál se leen los totales.

```claux:flujo
```

**Las monedas del negocio.** Se dan de alta desde un catálogo listo —peso cubano, MLC, dólar,
euro, libra, peso mexicano, dólar canadiense— o se crea una a medida con su código, su nombre y
su símbolo. **Los pares aparecen solos.** En cuanto hay dos monedas activas, su par de cambio
existe sin que nadie lo cree: no hay que configurar combinaciones. **Tres formas de tener la
tasa.** Cada par elige su fuente: *El Toque* para las tasas informales contra el peso cubano,
*Frankfurter* para el mercado internacional entre divisas, o *manual* cuando el negocio prefiere
fijarla él. **Se actualizan solas.** Las automáticas se refrescan cada madrugada, y hay un botón
para pedirlo al momento desde Monedas o desde el propio inicio del portal. **La moneda de
consolidación.** Es aquella en la que se expresan los estados consolidados; se elige y se puede
cambiar. **Se ve la edad de cada tasa.** Junto a cada una figura si es de hoy, de ayer o de hace
cinco días, y a partir de la quincena queda marcada como vieja.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

- **La moneda del documento es la real, no la convertida.** Una factura en dólares se guarda en
  dólares. La conversión es una lectura que se hace encima, nunca una sustitución del dato.
- **Toda tasa lleva fecha.** No hay «la tasa» a secas: hay la tasa de un par en un día. Por eso el
  portal puede decir cuánto ha envejecido y avisar cuando ya no representa el mercado.
- **Solo se admiten monedas que el negocio tiene configuradas.** Un código de moneda que no está
  dado de alta no cotiza: no tendría par ni tasa, y dejaría importes que no se pueden sumar con
  nada. El sistema lo rechaza en el momento de guardarlo, no después.
- **Un par se declara una vez y vale en los dos sentidos.** Decir que un dólar son trescientos
  veinte pesos es decir también cuántos dólares son mil pesos: CLAUX calcula el sentido contrario
  y no obliga a mantener dos cifras que podrían contradecirse.
- **Sin tasa no se inventa un número.** Si un par no tiene cotización, el importe se muestra en su
  propia moneda y no entra en el total convertido. Es preferible una cifra menos a una cifra
  falsa: un número convertido con una tasa supuesta parece un dato y no lo es.
- **Las tasas se refrescan solas, y también a mano.** Hay dos fuentes automáticas —una para el
  mercado informal cubano y otra para las divisas de cotización oficial— y una tarea diaria que
  las consulta para todos los negocios. El botón «Actualizar» del portal hace exactamente lo
  mismo, para el negocio que lo pulsa, cuando no se quiere esperar al día siguiente.
- **Actualizar tasas es la única operación que puede hacer un usuario de solo lectura.** Es
  deliberado: quien consulta necesita cifras vigentes, y refrescar una tasa no altera ningún
  documento.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Monedas y tasas no es un módulo que reciba trabajo de otros: es el que se lo da a todos. Cada
lugar del portal donde figura un importe pregunta por su moneda, y cada total consolidado pregunta
por su tasa.

```claux:conexiones
```

Funciona sin haber contratado nada: viene con CLAUX. Lo que aportan los módulos no es
funcionalidad que le falte, sino sitios donde su trabajo se nota.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Entrar en **Monedas y tasas** desde el menú de la cuenta.
2. Dar de alta las monedas con las que el negocio trabaja de verdad. Conviene ser corto: dos o
   tres suelen bastar, y cada moneda de más es un par más que mantener.
3. Revisar los **pares de cambio**, que ya estarán creados, y elegir la **fuente** de cada uno.
4. Fijar la **moneda de consolidación**: aquella en la que el dueño quiere leer los totales.
5. Pulsar **Actualizar** una vez para tener tasas del día desde el minuto uno.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Usted cobra en pesos, compra en MLC y paga en dólares. CLAUX guarda cada cosa en
su moneda, trae la tasa del día sola y le dice cuánto suma todo en la moneda que usted quiera.»

Esta pieza casi nunca se vende sola: se usa como **argumento de credibilidad** dentro de la
demostración de cualquier módulo. Es el momento en que el dueño reconoce que quien construyó el
sistema entiende cómo se trabaja en este mercado.

**Demo (dos minutos, encaja en cualquier presentación):**
1. Abrir **Monedas y tasas** y enseñar la lista de pares con la tasa y su fecha al lado.
2. Pulsar **Actualizar** y que la tasa se traiga sola delante del cliente.
3. Cambiar la **moneda de consolidación** y volver a un reporte: las mismas cifras, leídas en otra
   moneda, con la conversión señalada.

**Objeciones:**
- *«Yo solo trabajo en pesos.»* → Perfecto, entonces no tiene nada que configurar. El día que
  aparezca un proveedor que cobra en dólares, el sistema ya está preparado y no hay que rehacer
  nada.
- *«¿De dónde saca esa tasa?»* → De la referencia informal que el negocio ya consulta para el
  peso, y del mercado internacional para el resto. Y si el dueño prefiere poner la suya, puede:
  la fuente se elige par por par.
- *«¿Y si la tasa se mueve todos los días?»* → Se actualiza sola cada madrugada, y cada tasa
  enseña su edad para que nadie decida con un número viejo sin saberlo.

### 9. Precio y activación
> etiquetas: vender · básico

- **Sin coste adicional.** No es un módulo ni un addon: forma parte de CLAUX y está disponible se
  contrate lo que se contrate.
- **No hay que activarla.** Está desde el primer día; lo único que hace el negocio es dar de alta
  sus monedas.
- Configurar al menos una moneda es, de hecho, uno de los dos pasos que el portal pide al entrar
  por primera vez —el otro es crear la empresa—.

---

### Alcance honesto
> etiquetas: vender · básico

- Las tasas automáticas dependen de **fuentes externas**. Si una fuente no responde, el portal lo
  dice en vez de fingir que actualizó: se informa de qué pares entraron y cuáles fallaron.
- Una tasa que la fuente devuelve **igual** a la guardada no se cuenta como actualizada. Es
  deliberado: decir «1 tasa actualizada» cuando el valor es el mismo de siempre da una confianza
  que el dato no tiene.
- La conversión de los estados consolidados usa la **tasa vigente**, no la del día de cada
  documento. Es una vista de referencia y se señala como tal.
- La pieza convierte y presenta; **no gestiona cambio de divisa como operación**. Un cambio real
  de moneda se registra en Tesorería como el movimiento que es.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«La tasa no se actualiza.»** → Comprobar la **fuente** del par: si está en manual, no se toca
  sola por diseño. Si es automática, el mensaje de la actualización dice si la fuente falló.
- **«Sale que la tasa es vieja.»** → Han pasado más de quince días desde la última. Pulsar
  **Actualizar**; si el par es manual, hay que introducir el valor a mano.
- **«No puedo elegir esta moneda en una factura.»** → No está dada de alta o está inactiva en
  Monedas. Solo se ofrecen las monedas configuradas y activas.
- **«El total consolidado no coincide con mi suma.»** → Casi siempre es la conversión: el total se
  expresa en la moneda de consolidación y convierte a la tasa vigente lo que no está en ella.
- **«Quiero quitar una moneda que ya usé.»** → No se borra sin más. El portal enseña cuántos
  documentos la usan y ofrece **desactivarla** —deja de ofrecerse, el histórico se respeta— o
  **fusionarla** con otra.

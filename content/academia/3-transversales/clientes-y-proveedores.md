# Clientes y proveedores

> Pieza transversal · **no se cobra aparte**: viene incluida con Contabilidad, Inventario o
> Servicios · Menú lateral → Clientes y proveedores

Es la agenda del negocio: a quién se le vende y a quién se le compra. Una sola lista, compartida
por los módulos que la necesitan. El punto **6 es el corazón de la ficha**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**Clientes y proveedores es la lista única de con quién trabaja el negocio, con sus datos, sus
condiciones de pago y su historial, para que ningún nombre haya que volver a escribirlo dos
veces.**

### 2. Para quién
> etiquetas: usar · básico

Para todo negocio que facture a alguien o compre a alguien, que es todo negocio. La usa quien
emite facturas, quien registra compras y quien cobra: los tres nombran a la misma persona, y aquí
esa persona está una sola vez.

### 3. El problema que resuelve
> etiquetas: usar · básico

Sin una agenda única, los datos del cliente viven repartidos: el teléfono en el móvil de alguien,
el NIT en la última factura que se le hizo, lo que debe en la memoria del dueño. El coste no es
solo buscar: es que el mismo cliente acaba escrito de tres formas distintas —con y sin S.A., con
una errata—, y a partir de ahí ningún total por cliente es fiable. Clientes y proveedores fija
una ficha por persona o empresa, con los datos formales que exige un documento y las condiciones
comerciales pactadas, y hace que cada factura, cada compra y cada cobro se cuelgue de esa misma
ficha. La consecuencia práctica es que el dueño puede por fin responder a la pregunta que importa:
cuánto representa este cliente y cuánto le debo a este proveedor.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

Una ficha por persona o empresa, que va acumulando lo que ocurre con ella.

```claux:flujo
```

**Cliente, proveedor o las dos cosas.** Un mismo nombre puede comprar y vender; no hay que
duplicarlo. **Datos formales.** Nombre o razón social, NIT o carné de identidad, representante y
cargo, teléfono, correo y dirección: lo que un documento necesita para ser válido. **Condiciones
comerciales.** Condición de pago —contado, 15, 30, 60 o 90 días—, límite de crédito y moneda
predeterminada con la que se trabaja con él. **Vías de cobro y pago.** Las cuentas y formas por
las que se le paga o se le cobra habitualmente, para no ir a buscarlas cada vez. **Contrato.**
Número, fechas de inicio y fin y el documento firmado adjunto. **Su actividad, en pestañas.** Los
productos que suministra, las suscripciones que tiene contratadas y lo que se le debe.
**Historial.** Lo vendido y lo comprado mes a mes, en gráfico, para ver qué representa ese nombre.
**Archivar sin borrar.** Un tercero con el que ya no se trabaja deja de ofrecerse en los
selectores, pero su histórico queda intacto.

**Qué entra en el historial y qué no.** El gráfico recoge lo **facturado** y lo **comprado**, y deja
fuera los presupuestos: una oferta que quizá no se acepte nunca no es una transacción, y sumarla
inflaría el total con dinero que no existe. La serie no usa una ventana fija de meses: va **del
primer documento al último**, de modo que un tercero con dos facturas de hace un año tiene
historial y no una pantalla vacía. La deuda que muestra la ficha sale de la **misma fuente que la
página de cobros y pagos**, así que las dos pantallas dicen siempre lo mismo.

**Trabajo en lote.** Cuando hay que ordenar la lista de golpe —depurar nombres que ya no se usan,
o replicar una cartera al abrir una segunda empresa— se seleccionan varios y se **archivan,
restauran o copian** de una vez, con el mismo criterio que si se hicieran uno a uno.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

- **Cada tercero pertenece a una empresa.** No es una limitación arbitraria: la ficha lleva datos
  fiscales y condiciones que son de esa empresa. Con varias empresas, el mismo cliente tiene ficha
  en cada una, y el portal ofrece **copiarla** en vez de volver a escribirla.
- **La agenda es compartida; las pestañas dependen del módulo.** La lista es una sola y la ven
  todos los módulos que trabajan con nombres. Lo que cambia según lo contratado es qué se puede
  consultar en cada ficha: sin Inventario no hay productos, sin Contabilidad no hay deuda.
- **La ficha no se borra: se archiva.** Borrar un tercero dejaría facturas sin dueño. Archivar
  quita el nombre del futuro sin tocar el pasado.
- **La moneda del tercero es una propuesta, no una obligación.** Es la que se ofrece por defecto
  al facturarle; cada documento puede ir en otra.
- **Copiar a otra empresa vuelve a preguntar la moneda y el límite.** Son los dos datos que no
  viajan solos: un límite de cinco mil en una divisa, arrastrado tal cual a una empresa que trabaja
  en otra, deja de significar lo que significaba. Lo demás —datos fiscales, contacto, condiciones—
  se copia sin volver a teclearlo.
- **El límite de crédito avisa; no bloquea.** Al llegar al 90 % del tope entra un aviso en la
  bandeja, y otro distinto cuando se supera. Nadie impide seguir vendiendo: quien atiende ve la
  deuda y el tope delante y decide con esa información. La decisión de fiar es del negocio, no del
  sistema.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Clientes y proveedores es un recurso compartido: no produce nada por sí mismo, pero casi todo lo
que produce el portal lleva un nombre suyo encima.

```claux:conexiones
```

Al no ser un módulo, no se contrata: aparece en cuanto el negocio tiene Contabilidad, Inventario o
Servicios, que son los que trabajan con nombres. Lo que cada uno añade es contenido a la ficha, no
la ficha misma.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Entrar en **Clientes y proveedores** desde el menú lateral.
2. Crear la ficha: tipo —cliente, proveedor o ambos—, empresa a la que pertenece y nombre o razón
   social. Con eso ya se puede facturar.
3. Completar la **identificación fiscal** cuando el cliente vaya a necesitar un documento formal.
4. Fijar sus **condiciones comerciales** si se le vende a crédito.
5. Adjuntar el **contrato** cuando exista, con sus fechas: el portal avisará antes de que venza.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Cada cliente, una sola vez. Sus datos, lo que le ha comprado y lo que le debe, en
la misma pantalla, sin tener que buscarlo en tres sitios.»

Esta pieza rara vez se presenta sola: se enseña **dentro** de la demostración de facturación o de
compras, en el momento en que hay que elegir un nombre. Su valor se entiende mejor viéndola
funcionar que explicándola.

**Demo (encaja en la demostración de una factura):**
1. Al crear una factura, elegir el cliente de la lista y que **sus datos y su moneda entren
   solos**.
2. Abrir su ficha y enseñar el **historial**: qué se le ha vendido mes a mes.
3. Enseñar el **contrato** con fecha de fin y explicar que el portal avisa antes de que caduque.

**Objeciones:**
- *«Yo ya tengo mis clientes en una hoja.»* → Se importan. Y a partir de ahí cada factura los
  actualiza sola, algo que una hoja de cálculo no hace.
- *«Vendo al público, no tengo clientes con nombre.»* → Entonces no la necesita para vender; la
  usará para sus **proveedores**, que sí son siempre los mismos.
- *«¿Tengo que rellenar todos los campos?»* → No. Con el nombre basta para empezar; lo demás se
  completa cuando haga falta.

### 9. Precio y activación
> etiquetas: vender · básico

- **Sin coste adicional.** No es un módulo ni un addon, y no aparece en la factura de CLAUX.
- **No se activa:** está disponible en cuanto el negocio tiene contratado alguno de los módulos
  que trabajan con nombres —Contabilidad, Inventario o Servicios—.
- Las fichas pueden cargarse de golpe con el **importador**, sin teclearlas una a una.

---

### Alcance honesto
> etiquetas: vender · básico

- Las **vías de cobro y pago** son un dato documental de la ficha: están para consultarlas, no
  alimentan todavía ni la factura ni Tesorería.
- El **historial** solo aparece cuando hay módulo que lo llene: ventas con Contabilidad y compras
  con Inventario. Un proveedor en un negocio que solo tiene Contabilidad no muestra historial, y
  es correcto: su deuda se consulta en cuentas por pagar.
- La ficha es **por empresa**. Con varias empresas hay que copiarla, y el portal lo ofrece, pero
  no existe una ficha global de grupo.
- El **límite de crédito** avisa; no bloquea la venta. Es una decisión de producto: quien atiende
  ve la deuda y el tope en el momento y decide con esa información delante, en lugar de encontrarse
  con una venta que el sistema no deja cerrar.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No encuentro a un cliente que sé que existe.»** → Puede estar **archivado**, o estar dado de
  alta en **otra empresa**. Conviene comprobar la empresa antes que el nombre.
- **«El mismo cliente me sale dos veces.»** → Suele ser la misma persona creada en dos empresas.
  Es lo esperado; cada ficha lleva su empresa al lado.
- **«No puedo elegir su moneda.»** → La moneda predeterminada solo admite monedas configuradas y
  activas en **Monedas y tasas**.
- **«Quiero borrar un tercero.»** → No se borra si tiene documentos: se **archiva**. Deja de
  ofrecerse y el histórico se conserva.
- **«No me deja crear ni editar.»** → O el usuario es de **solo lectura**, o el negocio no tiene
  contratado ninguno de los módulos que usan la agenda.

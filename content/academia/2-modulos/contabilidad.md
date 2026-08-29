# Contabilidad

> Módulo (clave interna `base`) · en el portal: **Contabilidad**, un grupo de **8 páginas** ·
> transversal a todos los sectores, **no obligatorio**

Es el módulo más extenso del sistema: un grupo de ocho páginas que, en conjunto, sostienen el
circuito completo del dinero de un negocio. La ficha conserva la estructura A · B · C del resto;
la diferencia es que el punto **4 recorre las ocho páginas una a una**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**La Contabilidad de CLAUX administra el dinero del negocio de principio a fin: la facturación,
los gastos, las cuentas por cobrar y por pagar, la tesorería y el resultado.** Cada operación se
registra una sola vez y, a partir de ese registro, el sistema mantiene al día los saldos, las
deudas y el estado de resultados — sin exigir al usuario conocimientos contables.

### 2. Para quién
> etiquetas: usar · básico

Para cualquier negocio que facture, cobre, pague y necesite saber con certeza si gana o pierde:
desde una MIPYME que emite media docena de facturas al mes hasta una operación con varias monedas
y un asesor externo que reclama informes. Es un módulo transversal —vale para todos los
sectores— y **deliberadamente no obligatorio**: un cliente puede empezar por el Punto de venta o
el Inventario e incorporar la Contabilidad el día que quiera cerrar el círculo y ver sus números
consolidados.

### 3. El problema que resuelve
> etiquetas: usar · básico

La gestión informal fragmenta la información: las facturas en una libreta, los gastos en otra, el
efectivo en la caja y las deudas en la memoria del dueño. Con los datos dispersos, la pregunta
más elemental —cuánto se ganó realmente el mes pasado— no tiene una respuesta fiable, y
prepararla para el asesor consume una jornada entera de cuadres. La Contabilidad unifica ese
circuito: venta, gasto, cobro y pago quedan asentados en un mismo lugar y enlazados entre sí, de
modo que el estado de resultados se genera solo y concuerda en todo momento con la tesorería.

---

## B — Cómo funciona

### 4. Qué hace — sus ocho páginas
> etiquetas: usar · básico

El módulo se reparte en ocho páginas que cubren el ciclo económico completo. Antes del detalle
conviene ver la mecánica de fondo, común a todas: cada operación sigue el mismo recorrido, del
documento al resultado, sin ningún cuadre manual por el camino.

```claux:flujo
```

**Ventas — facturación y ofertas.** Se emiten **ofertas** (presupuestos) y **facturas**, y una
oferta se convierte en factura con un clic. La numeración es automática (FAC-2026-0001…), con sus
estados y un **PDF** descargable. Cada línea puede **enlazarse a un artículo del catálogo**, lo
que congela su coste y permite a CLAUX calcular el **margen**; admite descuento por línea (**en
porcentaje o importe**), unidad propia y coma decimal. Puede **cambiarse la moneda** del documento
—CLAUX reexpresa los importes y lo advierte— y, al emitir, **descontar del inventario** marcando
el almacén (si la factura se anula, las existencias se reponen). Se completa con duplicado,
archivado y acciones en **lote**.

**Gastos y cobros — el dinero que no pasa por una factura.** Registra un **gasto** con su
**categoría**, o un **cobro** con concepto libre. Las categorías de gasto las administra el propio
negocio (crear, renombrar, archivar) y cada una lleva asignado su **papel en el informe** —coste
de ventas, personal, operativo, inversión—, que es lo que determina dónde suma en el estado de
resultados.

**Cuentas por cobrar — quién debe al negocio.** Se construye sola, agrupando las **facturas con
saldo** y sus cobros. Muestra lo **pendiente**, lo **vencido** y lo **parcial**, ordenado por
antigüedad, y permite registrar un **cobro** total o parcial que rebaja el saldo al instante.

**Cuentas por pagar — a quién debe el negocio.** El reflejo simétrico: los **gastos y compras a
crédito** con su vencimiento, sobre los que se registra el **pago**, parcial o total.

**Tesorería — las cuentas y su saldo.** Reúne las cuentas de **caja, banco o pasarela**, con
**saldo por moneda**. Admite **movimientos** de entrada y salida, **transferencias** entre cuentas
y la edición de los asientos manuales; **avisa —sin bloquear—** cuando un movimiento deja una caja
en negativo. Cada cobro o pago de una factura o un gasto es, internamente, un movimiento de esta
página: por eso el efectivo y la deuda **cuadran solos**.

**Reportes — si el negocio gana o pierde.** Ofrece dos vistas complementarias: el **estado de
resultados** —lo devengado: Ingresos − Coste de ventas = Margen; − Personal − Operativos =
Resultado— y el **flujo de caja** —el efectivo que entró y salió realmente—. El estado de
resultados se presenta como un **desglose en cascada** con el **peso porcentual** de cada renglón,
la **comparación con el período anterior**, la **evolución mes a mes** y un puente explícito entre
lo devengado y lo cobrado. Se elige el **período** y la **moneda** de lectura (por defecto, cada
moneda con sus datos reales; convertir es opcional), se **descarga en PDF o Excel** y se **envía
al asesor** por correo con un botón. Para arrancar con orden, CLAUX incorpora un **plan de cuentas
de fábrica** por sector, que puede sembrarse tal cual o **adaptarse** con un asistente que propone
y el usuario confirma.

**Clientes y proveedores — la agenda económica.** Las fichas de **clientes y proveedores**, cada
una **por empresa** cuando se llevan varias, que se utilizan al facturar o registrar un gasto.

**Asesores — a quién se remiten los números.** El directorio del **contador o asesor** del
negocio, que alimenta el botón «Enviar al asesor» de Reportes. Alta rápida.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Seis reglas gobiernan el módulo, y conviene conocerlas porque explican por qué las cifras nunca
se descuadran:

- **El estado de un documento es el resultado de un cálculo, no una casilla que alguien marca.**
  Una factura figura como «cobrada» porque la suma de sus cobros alcanza el total; si se cobra la
  mitad, queda «parcial». Como nadie asigna los estados a mano, no pueden contradecir al dinero.
- **El libro no se borra.** Un movimiento erróneo se corrige con otro de signo contrario, y ambos
  permanecen registrados: siempre queda rastro. Las fichas —un cliente, una categoría— sí se
  archivan o eliminan; los asientos de dinero, no.
- **Cada moneda conserva sus datos reales.** Los informes muestran cada divisa por separado; solo
  cuando se pide un total en una moneda concreta, CLAUX convierte lo necesario a la tasa vigente y
  lo señala. No hay conversiones silenciosas.
- **Todo admite pago parcial.** Cualquier deuda puede saldarse en varios tramos, y el saldo se
  recalcula en cada uno.
- **El número fiscal se reserva al emitir, no al empezar.** Mientras es borrador, el documento
  lleva un identificador provisional que no se puede confundir con un número de factura. El
  correlativo definitivo —por empresa, por tipo de documento y por año— se toma en el momento de
  emitir. La razón es práctica: si cada borrador descartado se llevara un número, la serie
  quedaría con huecos permanentes, y un salto en la numeración de facturas es lo primero por lo
  que pregunta una inspección.
- **El sistema advierte; la decisión sigue siendo del negocio.** Sacar dinero de una caja hasta
  dejarla en negativo, o facturar por encima del crédito concedido a un cliente, no se bloquea: se
  avisa y queda registrado. CLAUX no conoce el acuerdo que hay detrás de cada operación, así que
  informa en lugar de impedir.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

La Contabilidad es el punto de convergencia del sistema: la mayoría de los módulos terminan
volcando aquí su rastro económico. El diagrama resume qué le entra, qué produce y en qué sentido
circula cada dato.

```claux:conexiones
```

Esa convergencia, sin embargo, no implica dependencia. La Contabilidad **arranca y opera por sí
sola**; todo lo anterior es llenado automático que se activa cuando el cliente incorpora la pieza
correspondiente, nunca un requisito previo.

```claux:capas
```

> Nota sobre la carga inicial: al importar el histórico, lo que venía ya pagado se salda contra
> una cuenta técnica de «Apertura», de modo que no altera los saldos reales de caja.

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Revisar las **monedas** del negocio y sus tasas.
2. *(Opcional)* **Sembrar el plan de cuentas** del sector, o adaptar uno propio.
3. Dar de alta las **cuentas** de caja y banco en Tesorería.
4. Cargar **clientes y proveedores**, a mano o con el importador.
5. Empezar a **facturar** y **registrar gastos**; los cobros y pagos irán marcando las cuentas.
6. Consultar **Reportes** para leer el resultado, y descargarlo o remitirlo al asesor.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Deje de estimar si gana. Facture, registre sus gastos y CLAUX le devuelve el
resultado —por mes, por moneda, en un PDF listo para su contador—, siempre cuadrado con la caja.»

**Demo:**
1. Emitir una **factura** de dos líneas y descargar el **PDF**.
2. Registrar un **cobro parcial**: la factura pasa a «parcial» y aparece en **Cuentas por cobrar**.
3. Anotar un **gasto** con su categoría.
4. Abrir **Reportes**: el estado de resultados ya está calculado, con su margen y su comparación;
   cambiar la moneda de lectura y **descargarlo**.

**Objeciones:**
- *«No entiendo de contabilidad.»* → No hace falta: el negocio factura y gasta, y el informe lo
  construye CLAUX. Si hay contador, se le remite con un botón.
- *«Trabajo con varias monedas.»* → Cada una se mantiene con sus datos reales; el total convertido
  es opcional y siempre queda señalado.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **El nivel también pone el techo de cuentas de tesorería.** Son las cuentas y las cajas por
  donde entra y sale el dinero. Las de apertura que crea el importador al migrar **no cuentan**:
  cobrarle cupo por ellas sería cobrarle por traerse sus propios datos.
- **No condiciona al resto:** se incorpora cuando el cliente decide ver sus números.

```claux:limites:cuentas_tesoreria
Cuentas de tesorería por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

Es **gestión del dinero, no un sistema de partida doble**: entrega el estado de resultados y el
flujo de caja del negocio, no asientos contables formales (ese es un escalón posterior). El asesor
recibe el informe en PDF y Excel. El **PDF de un documento no se previsualiza** dentro del
formulario: se consulta descargándolo desde su ficha.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«Vendo por mostrador y Ventas aparece en blanco.»** → Esas ventas entran por el **Punto de
  venta**; cada cierre de caja las traslada al informe. Sin cierres, no figuran ahí.
- **«El total en pesos no coincide con lo que esperaba.»** → Casi siempre es la **tasa** o el
  **rango de fechas**, no el dato. Conviene comprobar en qué moneda se está leyendo el informe.
- **«Moví una categoría y el informe de enero cambió.»** → Es el comportamiento correcto: el
  informe se recalcula con el plan de cuentas vigente. CLAUX avisa con cifras antes de confirmar.
- **«Seleccioné "Todo" y falta lo más antiguo.»** → El listado trae hasta un tope por fecha; usar
  «Traer más» o acotar el rango, que indica cuántos registros quedan fuera.

# Inventario

> Módulo (clave interna `inventario`) · en el portal: **Inventario**, un grupo de **4 páginas**
> (más Conteo físico) · funciona solo, no exige Contabilidad

Controla la mercancía física: qué hay, dónde está, cuánto vale y por qué cambió. Como en
Contabilidad, el punto **4 recorre sus páginas una a una**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**Inventario mantiene la cuenta de las existencias: qué producto, en qué almacén, en qué
cantidad y a qué coste** — y registra cada entrada, salida o traspaso, de modo que una
diferencia de stock siempre tiene una causa localizable.

### 2. Para quién
> etiquetas: usar · básico

Para cualquier negocio que **mueva mercancía física**: comercios, almacenes de distribución,
cafeterías y restaurantes (materia prima), talleres. El criterio es simple: si lo que se vende
se cuenta en unidades y se agota, corresponde a este módulo. Los **servicios no llevan
existencias** —se administran desde el módulo de Servicios—, y esa separación es deliberada.

### 3. El problema que resuelve
> etiquetas: usar · básico

El descontrol de existencias produce dos costes simultáneos y de signo contrario: se vende lo
que no hay —con el cliente ya comprometido— y se compra lo que sobra, inmovilizando capital
escaso. A ellos se añade un tercero, invisible: la **merma**. Lo que se rompe, se vence, se
regala o desaparece no figura en ningún sitio, y el negocio percibe el resultado como un
descuadre general en vez de como una partida medible. Inventario cierra las tres brechas al
convertir cada cambio de existencias en un movimiento con motivo: el saldo deja de ser una
estimación y la pérdida deja de ser una intuición.

---

## B — Cómo funciona

### 4. Qué hace — sus páginas
> etiquetas: usar · básico

El módulo se organiza en cuatro páginas más el conteo físico. Todas responden a una misma
mecánica de fondo: la mercancía entra, permanece valorada en un almacén, sale con un motivo
declarado y, periódicamente, se contrasta con la realidad.

```claux:flujo
```

**Productos — el catálogo de lo que se vende.** Cada ficha lleva **código**, unidad, categoría,
**coste** y **precio por moneda**, y su **mínimo** de reposición, que puede fijarse **general o
por almacén**. Estos productos son los que se enlazan en las líneas de una factura o una
compra: al seleccionarlos, CLAUX congela su coste en el documento y calcula el margen de la
operación.

**Almacenes — dónde está la mercancía.** Cada almacén muestra **qué contiene, cuánto vale, qué
está bajo mínimo** y una estimación de **cobertura en días** —cuánto durará al ritmo de salida
observado—. El stock se lleva siempre **por producto y almacén**, no en un total agregado: el
mismo artículo puede tener cinco unidades en la tienda y ninguna en el depósito, y esa
distinción es la que permite decidir un traspaso.

**Movimientos — el histórico de entradas y salidas.** Todo cambio de existencias es un
movimiento tipificado: **entrada, salida, ajuste o traspaso**. Las salidas y los ajustes exigen
un **motivo** de una lista cerrada (conteo, merma, rotura, caducado, robo, autoconsumo, regalo,
devolución, producción…). Esa exigencia es la que convierte la pérdida en una cifra: la merma
se puede sumar, comparar entre períodos y atribuir a una causa concreta. Un panel **«Revisar»**
concentra lo que requiere atención —existencias en negativo con su origen, productos archivados
que aún conservan stock, artículos sin coste asignado—.

**Compras — la reposición con proveedor.** Documento de compra con cabecera y líneas, con
numeración propia (**COM-2026-0001…**), de estructura análoga a una factura. Al **confirmar** la
compra, las existencias suben y queda registrado su gasto; anularla revierte ambos efectos. La
función **«Comprar lo que falta»** examina los mínimos y **propone** un pedido por almacén
—cuánto hay, cuánto falta y a qué proveedor acudir—, siempre sometido a confirmación antes de
crear nada.

**Conteo físico — el contraste con la realidad.** Se abre un conteo sobre un almacén, se cuenta
sobre el terreno y CLAUX calcula la **diferencia** contra el saldo del sistema. El borrador
**reside en el servidor** y se guarda de forma continua: el conteo puede repartirse en varias
sesiones y sobrevive a un corte de luz o de conexión sin pérdida de trabajo. Puede
**descargarse la plantilla** en Excel o PDF para contar en papel y **reimportar** las cantidades,
en lugar de teclearlas. Cada diferencia se justifica con su motivo y, al **aplicar**, CLAUX
genera los ajustes correspondientes y cierra el conteo como **acta**, que recoge el almacén
completo: lo que descuadró, lo que cuadró y lo que quedó sin contar.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cinco reglas explican el comportamiento del módulo, incluidas las decisiones que a primera
vista sorprenden:

- **El stock no se teclea: se mueve.** No existe un campo «existencias» editable a mano; la
  cifra es la suma de todas las entradas y salidas registradas. De ahí que el saldo siempre
  pueda reconstruirse y siempre pueda explicarse por qué cambió.
- **El stock negativo se permite deliberadamente.** Puede venderse aunque el sistema marque
  cero —en un mostrador la venta ya ocurrió, y bloquearla no la deshace—. CLAUX **lo hace
  visible** en «Revisar», pero no interrumpe la operación ni genera alarmas. Es flexibilidad
  buscada, no un defecto.
- **Contar produce un acta, no ajustes sueltos.** Si alguna diferencia carece de causa, no se
  aplica nada: aplicar solo una parte dejaría un saldo que ya no coincidiría ni con el sistema
  ni con lo contado.
- **El faltante no genera un gasto nuevo.** La mercancía se llevó a gasto al comprarla;
  imputarla otra vez la contaría dos veces. Durante el conteo sí se muestra la diferencia
  **valorada en dinero**, para dimensionar la pérdida sin duplicarla en el informe.
- **Coma decimal en todas las cantidades.** Media caja se guarda como media, no se redondea a
  cero ni a una.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Inventario ocupa una posición intermedia en el sistema: recibe el consumo que generan las
ventas y entrega la información de coste y disponibilidad que necesitan el libro y la carta
pública.

```claux:conexiones
```

Ninguna de esas conexiones es un requisito. El módulo **arranca y opera por sí solo** —con dar
de alta un almacén y unos productos basta—; lo que aportan las demás piezas es llenado
automático que evita teclear dos veces la misma operación.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Crear los **almacenes** (con uno es suficiente para empezar).
2. Dar de alta los **productos** con su coste, precio y mínimo, a mano o con el importador.
3. Registrar una **compra** para introducir la mercancía inicial: las existencias suben.
4. Operar con normalidad: las **facturas** y el **punto de venta** van descontando.
5. Periódicamente, ejecutar un **conteo físico** para cuadrar y medir la merma.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Deje de vender lo que no tiene y de comprar lo que le sobra. Sepa qué hay en
cada sitio, cuánto vale y cuánto se está perdiendo, al día.»

**Demo:**
1. Dar de alta un producto e introducirlo con una **compra**: el stock sube a la vista.
2. Emitir una **factura que descuente** de un almacén: el stock baja sin intervención.
3. Abrir un **conteo**, introducir una cantidad distinta y mostrar la **diferencia valorada** y
   su motivo.
4. Ejecutar **«Comprar lo que falta»**: el pedido ya viene propuesto.

**Objeciones:**
- *«Manejo poco producto, no me hace falta.»* → Con poco surtido un descuadre pesa más, no
  menos: cada unidad es una parte mayor del capital. Y queda montado para cuando crezca.
- *«Contar es un trabajo enorme.»* → Se descarga la plantilla, se cuenta en papel y se vuelve a
  subir; el acta la genera el sistema.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **El nivel también pone dos techos: productos y almacenes.** El de productos es el que se llena
  de verdad —una tienda que distingue tallas y colores sube muy rápido, porque cada combinación
  es una línea—; el de almacenes solo se toca cuando hay más de un local o un depósito aparte.
- **Funciona solo:** no exige Contabilidad. Con ella, las compras y las ventas quedan además
  reflejadas en el libro.

```claux:limites:productos,almacenes
Los dos techos de Inventario, por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

El coste registrado es el **último coste** de compra, fechado en cada cambio; **no** hay coste
medio ponderado. La **cobertura en días** es una **estimación** —requiere algo de histórico y,
si no lo hay, no se ofrece— y no se agrega en ningún informe. El stock negativo es una decisión
de producto: no debe presentarse como un defecto pendiente de corregir.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«Vendí y el stock no bajó.»** → O la línea de la factura no está **enlazada al producto**
  —hay que seleccionarlo del buscador, no escribir el nombre suelto—, o el documento no llevaba
  marcado «descontar del inventario».
- **«Un producto aparece en negativo.»** → Es lo esperado tras ventas de mostrador. Se consulta
  en el panel **«Revisar»** y se regulariza con un conteo o un ajuste.
- **«Conté y no me deja aplicar.»** → Alguna diferencia está sin **motivo**. Mientras falte una
  causa, no se aplica nada; basta con completarlas.
- **«Un servicio me aparece con existencias.»** → Los servicios no llevan stock; un `SRV-` con
  existencias procede de una semilla antigua. Se depura; los servicios no se cuentan aquí.

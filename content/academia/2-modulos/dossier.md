# Dossier del negocio

> Funcionalidad del catálogo (clave interna `dossier`) · en el portal: **Dossier**
> (`/portal/dossier`) · enlace público `/d/<token>` · funciona
> sola; con Contabilidad se rellena sola

Funcionalidad de un solo dominio: el punto **4 es un «Qué hace» único**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**El Dossier convierte los números del negocio en dos documentos destinados a un tercero: una
presentación en línea que se comparte por enlace y un estado de resultados en PDF** — ambos con
la marca del negocio y construidos sin trabajo de maquetación.

### 2. Para quién
> etiquetas: usar · básico

Para el negocio que necesita **presentarse ante alguien de fuera**: un **banco** al solicitar
financiación, un **inversor**, un socio potencial, un proveedor de cierto tamaño. En definitiva,
cualquiera que deba exponer con seriedad qué es su negocio y cómo va.

### 3. El problema que resuelve
> etiquetas: usar · básico

Cuando un tercero pide los números, el negocio se encuentra con dos materiales igualmente
inservibles: una hoja de cálculo, que contiene los datos pero no se puede enseñar, y una
presentación en blanco, que exige horas de maquetación para las que no hay ni tiempo ni oficio.
Lo que suele ocurrir es que se construyen por separado y acaban discrepando: el PDF dice una cifra
y la presentación otra, porque se actualizaron en momentos distintos. El Dossier elimina esa
divergencia por construcción: los dos documentos beben de **la misma foto de los números**, de
modo que actualizar una vez los deja a ambos al día y coherentes entre sí.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

El módulo produce dos salidas a partir de un mismo estado congelado de los datos, y ese es
justamente el rasgo que impide que se contradigan.

```claux:flujo
```

**La presentación** es una serie de diapositivas publicadas como **enlace web**: el relato del
negocio, el equipo y las cifras, con **color y logotipo propios del dossier** —la paleta se
deriva de un color base garantizando contraste legible—. Se difunde mediante un **enlace
revocable** y el dueño consulta **cuántas veces se ha abierto**. **El estado de resultados en
PDF** recoge ingresos, costes y resultado, en formato resumen o con desglose completo: el dueño
**decide cuánto expone**, desde una página de síntesis hasta el detalle por concepto.

El conjunto se arma con un **asistente** y tres pestañas —Mi dossier · Presentación · Estado de
resultados—. El asistente recorre siete pasos, que después se pueden retomar sueltos desde «Mi
dossier»: **Lo básico**, **Coste de ventas** —que solo se pregunta cuando hay Contabilidad; sin
ella es una columna más de la rejilla—, **Los números**, **El desglose**, **Crecimiento**, **El
relato** y **La marca**. El borrador puede **previsualizarse** antes de publicar, la versión en
**inglés** se genera con un botón, y quien no se maneje con la redacción puede pedir a la IA que
**escriba** los textos.

Tres de esos pasos son los que dan al documento su valor delante de un tercero. **Los números** es
la rejilla mensual —ingresos, coste de ventas y gastos operativos, mes a mes— de la que salen los
totales; sobre ella el Dossier calcula además los **márgenes**, que la contabilidad no produce por
sí sola. **El desglose** contesta la pregunta que hace siempre quien pone dinero —*en qué se va*—
repartiendo el gasto por grupos con su peso sobre los ingresos, y se concilia contra los totales
del paso anterior, de modo que las dos cifras no puedan discrepar. **Crecimiento** dibuja la
proyección: CLAUX toma la **media de los tres últimos meses** —no el último, para que un mes
atípico, malo o extraordinariamente bueno, no tuerza la recta— y la compone al ritmo mensual que
el dueño fije, durante los meses que elija.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Seis reglas explican el comportamiento del módulo:

- **Se actualiza una vez y cambian los dos documentos.** Ambos proceden de la misma foto de los
  números; el dueño la refresca cuando lo decide, y hasta ese momento nada se mueve bajo sus pies
  mientras el enlace está circulando.
- **La marca es del dossier, no del negocio.** El color y el logotipo pertenecen a este
  documento: un mismo negocio puede mantener un dossier sobrio para el banco y otro más
  expresivo para un inversor, sin alterar su identidad general.
- **El enlace es privado y revocable.** Es una dirección larga generada al azar: no se adivina, no
  se indexa en buscadores y no aparece en ninguna búsqueda. Quien lo tiene, entra; el acceso puede
  cortarse en cualquier momento, y dentro del mismo enlace pueden convivir **dos idiomas**.
- **El dueño controla el nivel de exposición.** Puede publicar solo el resumen —las cifras y los
  márgenes— o el detalle completo, que añade en qué se va cada grupo con su peso sobre los
  ingresos. Ese ajuste **no altera las cifras**, únicamente cuánto de ellas se muestra, y el
  propio PDF dice en su título cuál de los dos es.
- **Traer los números no pisa lo escrito a mano.** Cuando la Contabilidad aporta datos, CLAUX no
  sobrescribe: compara mes a mes y separa cuatro casos —los meses **nuevos** que añade, los que
  venían de la contabilidad y **cambiaron**, los que se escribieron a mano y la contabilidad no
  conoce, que quedan **intactos**, y los pocos en que ambas fuentes dicen cosas distintas, que se
  presentan como **conflicto** para que decida el dueño—. El plan se enseña antes de aplicarlo.
- **La foto envejece, y CLAUX lo dice.** Un dossier publicado avisa de que conviene refrescarlo
  cuando han pasado más de **45 días** desde la última actualización de los números, o antes si se
  ha cambiado algo que afecta a lo que muestra —el período, la moneda de presentación, el modo de
  publicación—. El aviso es para el dueño; el enlace sigue funcionando y enseñando la última foto
  publicada.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

El Dossier es esencialmente receptor: recoge de los demás módulos el material con que se
construye y no alimenta a ninguno. Cuántos dossiers pueden estar vivos a la vez no depende de
nada de aquí: lo fija el **nivel** del cliente.

```claux:conexiones
```

La funcionalidad **se completa íntegramente a mano**: sin Contabilidad se teclea el desglose
—CLAUX propone las **filas típicas del sector**, nunca los importes—, sin RRHH se escribe el
equipo y sin el addon de IA se redactan los textos. Lo que aportan las demás piezas es evitar esa
transcripción.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Crear el dossier con el **asistente**: nombre, color y logotipo.
2. Escribir el **relato** —o pedir a la IA un primer borrador— y revisar el **equipo**.
3. Completar **los números**, o traerlos de Contabilidad, y elegir **cuánto se expone**.
4. **Previsualizar el borrador** y, cuando esté conforme, **publicar** y compartir el enlace.
5. *(Opcional)* Generar la versión en **inglés**.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Presente su negocio a un banco o a un inversor con un enlace y un PDF de buena
factura, hechos con sus propios números y actualizados en un clic.»

**Demo:**
1. Abrir un dossier de ejemplo por su **enlace público** y mostrar la presentación con su marca.
2. Enseñar el **estado de resultados en PDF** y cómo el dueño elige entre **resumen o desglose**.
3. Con Contabilidad, **traer los números** y comprobar que no pisa lo escrito a mano.
4. Generar la versión en **inglés** con un botón.

**Objeciones:**
- *«Eso me lo hace mi contador.»* → Esto no es para la ONAT, sino para enseñar: un documento con
  marca, en dos idiomas, que se actualiza en un clic.
- *«No llevo la contabilidad en CLAUX.»* → Funciona igualmente a mano; y el día que la lleve
  aquí, se rellenará solo.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **Funciona sola.** Cuántos dossiers pueden estar vivos a la vez lo fija el **nivel**, no un
  añadido que se compre aparte. Está en la ficha «Varios dossiers», en el índice.

---

### Alcance honesto
> etiquetas: vender · básico

Sin el módulo **Inventario**, el «coste de ventas» que aporta la Contabilidad son las **compras
del período**, no el coste de lo vendido: el propio documento lo advierte con una nota. La
**descarga de la presentación en PDF desde el móvil** recurre a la impresión del navegador —la
ruta de PDF de servidor está desactivada de momento en producción—. La presentación **no incluye**
los pendientes internos del dueño: un inversor no debe ver lo que falta por hacer. Las tipografías
se cargan desde Google Fonts, con el autoalojamiento pendiente.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«Traje los números de Contabilidad y se borró lo que había escrito.»** → No debería: traer es
  **fusión no destructiva** y pide confirmación antes de tocar una fila manual. Conviene revisar
  la previsualización.
- **«Las tres secciones del estado de resultados salen vacías.»** → Sin **Contabilidad** hay que
  teclear el **desglose**; CLAUX propone las filas del sector, no los importes.
- **«El PDF de la presentación sale vertical y roto en el móvil.»** → Es una limitación del
  navegador móvil; desde escritorio se genera correctamente. La ruta de PDF de servidor sigue
  pendiente en producción.
- **«Cambié cuánto enseño y me pide confirmar un desfase.»** → No debería: alternar entre resumen
  y desglose **no toca las cifras**. Si pide confirmación, el cambio pendiente es otro.

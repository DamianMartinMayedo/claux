# Menú / catálogo digital

> Funcionalidad del catálogo (clave interna `catalogo_qr`) · en el portal: **Catálogo digital**
> (`/portal/catalogo`) · página pública `/tu-negocio/catalogo` ·
> en restauración se presenta como «Menú»

Funcionalidad de un solo dominio: el punto **4 es un «Qué hace» único**, no un recorrido por
páginas.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**El catálogo digital publica la carta o el catálogo del negocio en línea: el cliente lo abre con
un código QR o un enlace y consulta fotos, precios y disponibilidad**, mientras el negocio lo
actualiza en segundos, sin coste de impresión ni retraso entre la decisión y su efecto.

### 2. Para quién
> etiquetas: usar · básico

Para restaurantes y cafeterías —la **carta**—, comercios —el **catálogo** de productos— y
cualquier negocio de servicios que necesite **exponer su oferta** con precio e imagen. La misma
pieza se presenta como **Menú** o **Catálogo** según el sector, sin que cambie el funcionamiento.

### 3. El problema que resuelve
> etiquetas: usar · básico

Una carta impresa fija los precios el día que se manda a imprenta y los mantiene congelados hasta
la siguiente tirada. En un entorno de precios inestables eso convierte cada ajuste en un dilema:
o se reimprime —con su coste y su demora— o se corrige a mano delante del cliente, con el
desgaste de imagen que supone. Lo mismo ocurre con la disponibilidad: un plato agotado sigue
figurando en la carta hasta que alguien lo explica en cada mesa. El catálogo digital elimina esa
distancia entre la decisión y su publicación: **cambiar un precio o marcar «agotado» surte efecto
de inmediato**, y el cliente lo consulta desde su propio móvil sin instalar nada.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

La funcionalidad tiene dos caras: un editor en el portal y una página pública. El recorrido entre
ambas es directo y sin pasos intermedios.

```claux:flujo
```

El **editor** del portal se organiza en tres pestañas. En **Ítems** vive cada plato o producto
con su **foto, descripción, precio y categoría**; se marca **«Agotado»** con un toque y un precio
en blanco se publica como **«Consultar precio»**. Admite **descuento** por ítem o por categoría
y, fuera del ámbito de la comida, una **periodicidad** —«/mes» para un servicio—. Los ítems
pueden **duplicarse** y **ordenarse** manualmente. En **Categorías** se agrupan los ítems
—Entrantes, Bebidas, Postres…— con su propio orden. En **Configuración + QR** se fija la
**dirección web** del negocio, se descarga el **código QR** destinado al local o a las mesas, y
se eligen la **moneda** de exposición de precios y el aspecto de la página.

Dos comodidades del editor conviene conocerlas porque ahorran horas de alta: los ítems se pueden
**tratar en lote** —marcar varios como agotados o eliminarlos de una vez— y, si el negocio ya lleva
Inventario, **traerse los productos** que ya tiene dados de alta en lugar de teclearlos otra vez.
Las **fotografías se procesan solas**: se sube la imagen tal como salió del móvil y el sistema la
convierte a un formato ligero, en dos tamaños —uno para la lista y otro para el detalle—, de modo
que el cliente final descarga una fracción del peso original.

La **página pública** presenta el catálogo agrupado por categoría, en **lista** —la variante más
ligera— o en **tarjetas** con fotografía. Al tocar un ítem se abre su **ficha**: la fotografía
grande, la descripción, el precio con su descuento —y el precio anterior tachado, si lo hay— y, en
restauración, los **ingredientes, los alérgenos y las calorías**. Está construida para el móvil y
para conexiones lentas: esa restricción condiciona su diseño más que cualquier consideración
estética.

**Se puede instalar en el móvil del cliente.** La página pública es también una aplicación
instalable: el navegador ofrece añadirla a la pantalla de inicio, y queda ahí con el nombre y el
icono del negocio, sin pasar por ninguna tienda de aplicaciones. Una vez visitada, **vuelve a
abrirse sin conexión** con la última versión consultada; las fotografías, que no cambian, se
guardan en el propio teléfono. La instalación queda acotada a ese negocio: no arrastra ninguna otra
parte de CLAUX.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cinco reglas describen su comportamiento:

- **El cambio es inmediato.** Subir un precio o marcar un ítem como agotado se refleja en la
  página pública prácticamente al instante, sin publicación manual ni aviso a terceros: guardar en
  el editor **es** publicar. No hay dos versiones del catálogo, una en borrador y otra en la calle.
- **La velocidad se prioriza sobre la vistosidad.** La página pública se sirve preferentemente
  desde caché y arranca en modo lista, el más ligero; el cliente pasa a tarjetas si lo desea. En
  una conexión lenta, una carta que no carga equivale a una carta que no existe.
- **Una carta ya vista se abre sin conexión.** Quien la haya consultado alguna vez vuelve a verla
  aunque en ese momento no tenga datos. Es la última versión que le llegó, no necesariamente la de
  hoy: la actualiza en cuanto haya red.
- **La moneda expuesta es realmente la del negocio.** Los precios se muestran en la moneda
  elegida, convertidos con la tasa vigente cuando hace falta; nunca se coloca un símbolo de una
  divisa sobre un importe que estaba expresado en otra.
- **La página se adapta al sector.** En restauración aparecen los campos propios de la comida
  —ingredientes, alérgenos—; en un comercio, no. También cambia la etiqueta del ítem: «Plato»,
  «Artículo», según corresponda.
- **«Agotado» no oculta el ítem.** La imagen se atenúa pero el ítem permanece legible, para que
  el cliente sepa que existe habitualmente y volverá a estar disponible.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

El catálogo es la cara pública del negocio y, como tal, comparte identidad con las demás piezas
públicas y recibe contenido de las internas.

```claux:conexiones
```

La funcionalidad es **independiente**: mantiene su propia lista de ítems y se vende y opera sin
ningún otro módulo. Las importaciones son llenado rápido, no dependencias.

Comparte con Reservas y con Citas **la dirección web del negocio**: es la misma para las tres, se
fija una vez y desde cualquiera de ellas. De **Inventario** puede traerse los productos ya dados de
alta, una sola vez y como punto de partida; después el catálogo sigue su camino y los precios de la
carta no son los del almacén. Del **sector** toma las palabras —«Menú», «Carta», «Catálogo»,
«Plato», «Artículo»— y los campos propios de la comida. Y al **Dashboard** le devuelve una señal:
cuántos ítems publicados están sin foto o sin precio, que es lo que estropea la carta a ojos de
quien la mira.

Lo que **no** hace es enviar información de vuelta: la página pública no genera pedidos, no descuenta
existencias y no crea reservas. Es exposición, no operación.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Fijar la **dirección web** y elegir la **moneda** del catálogo, en Configuración.
2. Crear las **categorías** y añadir los **ítems** con foto y precio, o importarlos.
3. **Descargar el QR** y colocarlo en las mesas o en la entrada.
4. Mantenerlo al día: marcar como agotado lo que falte y ajustar los precios cuando proceda.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Su carta siempre al día, sin reimprimir. El cliente la abre con el QR de la mesa,
ve las fotos y los precios, y usted marca ‘agotado’ o cambia un precio en un segundo.»

**Demo:**
1. Añadir un **ítem** con foto y precio; abrir la **página pública** en el móvil con el QR.
2. Marcar uno como **«agotado»** y mostrar el cambio en vivo.
3. Cambiar la **moneda** del catálogo y ver los precios reexpresados.
4. En el móvil, **añadir la carta a la pantalla de inicio** y volver a abrirla con los datos
   apagados: sigue ahí. Es el momento que más impresiona de la demostración.

**Objeciones:**
- *«Tengo la carta impresa.»* → El papel queda desfasado el día que sube un precio, y volver a
  imprimir cuesta. Esto se corrige en el momento, y además entra por un QR en la propia mesa.
- *«Mis clientes no escanean códigos QR.»* → También hay un enlace que se comparte por WhatsApp;
  el QR es únicamente el atajo dentro del local.
- *«¿Y si el cliente no tiene datos en el móvil?»* → Quien ya abrió la carta alguna vez la vuelve a
  ver sin conexión. Para quien entra por primera vez sigue haciendo falta red, como en cualquier
  página.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **Funciona sola:** no exige Inventario ni ningún otro módulo.

---

### Alcance honesto
> etiquetas: vender · básico

La página pública es hoy **navegación pura**: expone la oferta, pero **no admite pedidos ni
enlaza con Reservas o Citas** desde ella —está registrado como mejora futura—. La **mini-web
completa** (horarios, ubicación) y el **chat público con IA** siguen pendientes. No debe
prometerse «pedidos desde el menú».

La carta se publica en **un solo idioma**: el multi-idioma no está construido. Ya no aparece en
la descripción comercial —la ficha viva del catálogo no lo menciona, y la **mig. 203** lo quitó
también de la semilla, junto con el «+ mini-web» que el nombre arrastraba—, así que no hay nada
que desmentir delante del cliente. Sigue sin poder prometerse.

La apertura **sin conexión** cubre a quien ya visitó la carta al menos una vez; a quien la abre por
primera vez sin datos, no le llega nada. Y lo que se ve entonces es la última versión que alcanzó
ese teléfono, que puede no incluir el precio cambiado hace diez minutos.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«Cambié un precio y no se ve.»** → La página pública se refresca en segundos; conviene
  recargar. Si se editó un ítem, comprobar que el cambio quedó guardado.
- **«El precio aparece en otra moneda.»** → Revisar la **moneda del catálogo** en Configuración;
  si falta el par de cambio, el importe se muestra en la moneda original del ítem.
- **«No me deja guardar mi dirección web.»** → La dirección es **del negocio** y se guarda desde
  aquí igual que desde Citas o Reservas; si otra pieza ya la usa, es exactamente la misma.

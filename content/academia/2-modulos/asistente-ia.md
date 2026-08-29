# Asistente IA

> Addon (clave interna `asistente_ia`) · **amplía lo que el negocio ya tiene**, no añade una
> página nueva

Es un addon transversal: enciende capacidades dentro de las pantallas que el negocio ya utiliza.
El punto **4 recorre dónde actúa**; el **6 es el corazón de la ficha**, porque su valor depende
enteramente de qué módulos haya contratados.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**El Asistente IA incorpora al negocio un ayudante con inteligencia: repasa la nómina antes de
confirmarla, autocompleta fichas, permite que el cliente escriba al bot en lenguaje corriente y
responde al dueño preguntas sobre sus propios números.**

### 2. Para quién
> etiquetas: usar · básico

Para el negocio que **ya opera con varios módulos** y quiere descargarse del trabajo repetitivo y
recibir aviso de lo anómalo. La relación es directa: cuanto más tiene montado —nómina,
inventario, catálogo, reservas—, **más puntos del sistema donde la IA interviene**.

### 3. El problema que resuelve
> etiquetas: usar · básico

El trabajo administrativo de un negocio pequeño concentra dos tipos de tarea que agotan por
motivos opuestos. Unas son mecánicas y de bajo valor —describir un producto, transcribir un
conteo, redactar un texto de presentación— y consumen tiempo del dueño en lo que menos lo
merece. Otras exigen una atención sostenida que nadie mantiene mes tras mes: revisar línea a
línea si una nómina tiene algo fuera de lugar. La IA cubre las dos: ejecuta lo mecánico y vigila
lo que requiere revisión, dejando la decisión siempre del lado humano.

Conviene ver dónde queda la frontera, porque es lo que distingue este addon de un chat genérico.
Un modelo de propósito general puede redactar el texto, pero no sabe cuánto se vendió la semana
pasada ni qué producto está por agotarse; y si se le piden cifras, las inventa con la misma
soltura con que redacta. Aquí ocurre lo contrario: **los números los pone CLAUX y la IA pone las
palabras**, cada una en lo que hace bien.

---

## B — Cómo funciona

### 4. Qué hace — repartido por el negocio
> etiquetas: usar · básico

El addon no abre una pantalla propia: aparece dentro de las existentes. En todos los casos el
ciclo es el mismo, y conviene retenerlo porque explica el límite de la herramienta.

```claux:flujo
```

Los **consejos por sección** —Dashboard, Ventas, Gastos, Reportes, Inventario, RRHH, Tesorería,
Catálogo, Reservas, Citas, Punto de venta, Suscripciones— se presentan como un icono con una
observación sobre **los datos del propio negocio**, no una recomendación genérica de manual. El
**autocompletado de fichas** actúa en Inventario y en el Catálogo, rellenando descripción, unidad
y categoría de una vez, sujeto a confirmación. El **conteo dictado** permite decir producto y
cantidad en voz alta: la IA rellena la casilla y el emparejamiento con el catálogo lo resuelve
CLAUX, sin aplicar nada hasta que se confirma. El **repaso de la nómina** compara a cada
trabajador con sus meses anteriores y señala lo que se sale de su patrón —un salto de importe sin
días que lo justifiquen, una retención a cero—, pero **no confirma nada**. Completan el conjunto
la **explicación del recibo** en lenguaje llano para el trabajador, la **redacción de los textos
del Dossier**, el **chat del dueño** en una ventana flotante para preguntar al negocio en lenguaje
corriente, y el **bot en lenguaje natural**, que interpreta lo que el cliente escribe a Citas o
Reservas en lugar de exigirle recorrer botones.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Siete reglas delimitan lo que el addon hace y, sobre todo, lo que no hace:

- **Nunca decide: siempre propone.** La IA sugiere, señala y redacta; **la última palabra es del
  dueño**. No confirma nóminas, no aplica conteos y no modifica cifras.
- **Trabaja con los datos del negocio, no en abstracto.** Cada consejo se apoya en las ventas, el
  stock y los movimientos reales de ese cliente, acotado a lo que tiene contratado.
- **Las cifras las calcula CLAUX.** En el Dossier y en la nómina, la IA **lee y redacta**; los
  números proceden del motor de siempre. Esa separación es deliberada y es lo que impide que un
  modelo produzca un importe inventado.
- **El consumo se administra.** Los repasos no se lanzan por su cuenta —consumen cupo del
  addon—: se solicitan cuando se necesitan.
- **El cupo se mide en conversaciones y avisa antes de agotarse.** Cada negocio tiene un número de
  conversaciones al mes; al llegar al **90 %** salta un aviso en la campana, con tiempo para
  decidir.
- **Pasado el cupo no se corta: se baja de marcha.** Superado el tope, las consultas siguen
  atendiéndose con un **modelo de respaldo** en lugar de dejar de funcionar. Es una decisión
  deliberada: cortar a mitad de mes convertiría el addon en algo con lo que no se puede contar, y
  una respuesta más modesta es mejor que ninguna.
- **La IA ve un resumen del negocio, no el negocio entero.** No se le entrega la base de datos:
  recibe un extracto compacto y ya agregado —lo mismo que resume el inicio del portal—, acotado
  además a los módulos contratados, de modo que un negocio que solo lleva Reservas no aporta
  ninguna cifra financiera. Y ese extracto es **de su negocio y de ninguno más**.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Aquí está el núcleo del addon. No es una pieza que se añada al lado de las demás, sino una capa
que se apoya sobre ellas: cada módulo contratado abre un lugar más donde la IA interviene.

```claux:conexiones
```

Conviene ser preciso al venderlo: sin otros módulos el addon **funciona** —el chat del dueño y los
consejos con datos propios siguen operativos—, pero rinde una fracción de lo que puede. Su valor
es acumulativo por diseño.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Se **activa** desde la ficha del cliente: aparecen el **chat flotante** y los iconos de consejo
   repartidos por las pantallas.
2. Probar el **chat del dueño** con una pregunta sobre el negocio.
3. En la siguiente **nómina**, lanzar el **repaso** antes de confirmar.
4. Autocompletar una **ficha** de producto para comprobar el ahorro.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Un ayudante que le quita el trabajo mecánico y le avisa de lo anómalo: le repasa
la nómina, le rellena las fichas y le contesta sobre su propio negocio en lenguaje corriente.»

**Demo (con un cliente que ya use módulos):**
1. Abrir el **chat del dueño** y preguntar «¿cómo voy este mes?».
2. **Autocompletar** una ficha de producto.
3. En una nómina de prueba, lanzar el **repaso** y mostrar un aviso.
4. Escribir al **bot** de Citas en lenguaje corriente.

**Objeciones:**
- *«No me fío de que la IA toque mis números.»* → No los toca: **propone**, y la decisión es del
  dueño. Las cifras las calcula CLAUX, no el modelo.
- *«¿Para qué lo quiero?»* → El ahorro escala con los módulos contratados: revisar la nómina,
  describir productos, atender el bot de madrugada.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- Se activa desde la ficha del cliente y **rinde más cuantos más módulos** tenga el negocio.
- **Va por cupo de conversaciones al mes, y el cupo lo fija el nivel.** Es el único tope que no
  desaparece en el nivel más alto: el modelo caro lo paga CLAUX. Y al agotarlo **el asistente no se
  apaga** — pasa al modelo gratuito. Lo que se promete es que siga respondiendo, no que sea
  ilimitado; decirlo así en la venta evita la única queja que este addon puede generar.

```claux:limites:ia_conversaciones
Conversaciones al mes por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

Tiene un **cupo mensual** de conversaciones —tope blando: al pasarlo no se corta, se baja de
marcha— y **la cifra la pone el nivel del cliente**, no este addon; la de cada uno está unos
párrafos más arriba, en «Precio y activación». El **chat público para
el cliente final**, embebido en el catálogo y con tráfico anónimo, **todavía no existe**: hoy la
IA atiende al **dueño** y al **bot** de Citas y Reservas. El proveedor y el modelo se configuran
desde el admin. La IA **no calcula cifras**, las lee: si un consejo muestra un número, procede del
motor de CLAUX.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No veo los iconos de consejo.»** → O el addon no está **activo**, o esa sección pertenece a
  un módulo que el cliente no tiene contratado.
- **«El bot no entiende lenguaje natural.»** → Sin el addon, el bot opera con **botones**; con el
  addon activo interpreta texto libre.
- **«Se agotó el cupo.»** → Es el tope mensual del addon, y los repasos consumen. Se ajusta desde
  el admin.
- **«Un consejo dio un número que no cuadra.»** → La IA **no calcula**: si la cifra viene mal, hay
  que revisar el dato de origen, no el modelo.

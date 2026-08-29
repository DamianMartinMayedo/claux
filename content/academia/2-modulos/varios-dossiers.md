# Varios dossiers

> Capacidad del nivel · **amplía el Dossier**: cuántos caben a la vez · no se compra aparte, el
> tope lo fija el nivel contratado · **requiere el Dossier**

Alcance reducido y muy definido: cuántos dossiers puede tener el negocio a la vez. Hasta 2026 se
vendía como el addon «Multidossier»; hoy es una dimensión más del **nivel**. El punto **6 es el
corazón de la ficha**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**El negocio mantiene varios dossiers simultáneos, cada uno con su propio enlace** —
para dirigirse de manera distinta a un banco, a un inversor y a un socio sin que un documento
sustituya al anterior.

### 2. Para quién
> etiquetas: usar · básico

Para el negocio que ya emplea el **Dossier** y necesita **más de una versión**: una sobria para el
banco, limitada al resumen; otra con el detalle para un inversor; otra en inglés para un
interlocutor extranjero.

### 3. El problema que resuelve
> etiquetas: usar · básico

Con un único dossier, cada nuevo destinatario obliga a sobrescribir el anterior. El coste no es
solo rehacer el contenido: el enlace ya compartido pasa a mostrar un documento distinto del que se
anunció, de modo que quien lo abra días después verá algo que no le corresponde —y un banco que
vuelve sobre el enlace de la semana pasada y encuentra otras cifras no concluye que el documento
se actualizó, concluye que no puede fiarse de él—. Tener varios elimina esa colisión al dar a cada
destinatario **su propio documento y su propio enlace**, permanentemente disponibles, de modo que
cada conversación avanza a su ritmo sin pisar a las demás.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

La transformación es sencilla de describir: convierte un documento único en una colección.

```claux:flujo
```

**Convierte el Dossier en un listado.** En lugar de un solo documento, el portal presenta una
lista y cada dossier vive por su cuenta, con su relato, su marca y su **enlace propio**. La lista
está pensada para decidir de un vistazo cuál abrir y cuál está listo para enviar: de cada uno
enseña su **estado** —borrador o publicado—, el **período** que cubre, la **moneda** en que se
presenta, cuándo se actualizaron por última vez sus números y si conviene refrescarlos.

**Duplicar para arrancar rápido.** El caso real no es tener documentos distintos, es el **mismo
negocio contado a otro interlocutor**: los números ya están y lo que cambia es el relato, así que
volver a teclear doce meses sería la fricción que hace que el segundo dossier no llegue a nacer.
Duplicar copia los números —la serie mensual, el desglose por concepto—, el relato, la marca, el
período, el ritmo de crecimiento y el modo de publicación; **no copia la historia de
publicación**: la copia nace en **borrador**, sin enlace y con «(copia)» en el título, y se gana su
propio enlace al publicarse. El del original ni se entera. Duplicar cuenta como crear, de modo que
consume el mismo permiso.

**Trabajo en lote.** Con varios documentos en la lista, se pueden **duplicar, despublicar o
eliminar varios a la vez** en lugar de uno por uno.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cuatro reglas lo describen por completo:

- **Cada dossier es independiente.** Su contenido, su color, su enlace y su recuento de aperturas
  le pertenecen: modificar uno **no repercute** en los demás.
- **Duplicar no comparte el enlace.** La copia obtiene el suyo propio, de modo que enseñar la
  copia no abra por descuido el documento original.
- **El límite es uno solo: cuántos dossiers caben.** Publicar no se limita aparte. Cuando el
  addon existía sí hacían falta dos topes —«un dossier» significaba «un enlace vivo», y sin el
  segundo tope bastaba con duplicar para repartir cinco enlaces—; con el nivel no queda hueco:
  nadie puede publicar más de los que le caben, y quien paga tres tiene derecho a sus tres enlaces.
- **Bajar de nivel no destruye nada.** Los dossiers ya creados se conservan, se ven y se editan;
  lo que se limita es **crear** más. Al llegar al tope, el portal lo dice en ese momento y ofrece
  hablar de subir de nivel, en lugar de esconder el botón.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Es una capacidad **del Dossier** y solo tiene sentido sobre él: no aporta nada nuevo al documento,
solo dice cuántos caben.

```claux:conexiones
```

Todo lo demás del Dossier permanece intacto —traer los números de Contabilidad, precargar el
equipo de RRHH, los botones de IA para redactar y traducir—. Lo único que cambia es **cuántos**
documentos pueden existir a la vez.

Ese matiz importa al venderlo: no es un módulo que se pueda contratar suelto. Sin Dossier no hay
nada que multiplicar, y por eso el portal ni siquiera lo ofrece a quien no lo tiene. Tampoco cambia
la relación del Dossier con el resto del portal: cada documento sigue leyendo de la contabilidad y
del equipo del negocio por su cuenta, y **dos dossiers del mismo negocio pueden traer los números
en fechas distintas**, con lo que sus cifras no tienen por qué coincidir. No es un fallo: cada uno
guarda la foto del día en que se trajo. El **Dashboard** vigila esa diferencia por el lado que
importa —avisa de los dossiers publicados cuya foto ya envejeció—, y ese aviso pasa a ser plural en
cuanto hay varios.

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Se **activa** desde la ficha del cliente, que debe tener el Dossier contratado.
2. `/portal/dossier` pasa a comportarse como un **listado**.
3. **Crear** un dossier nuevo o **duplicar** uno existente como punto de partida.
4. Publicar cada uno y compartir **su** enlace con el destinatario que corresponda.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Un dossier para el banco, otro para el inversor, otro en inglés — cada uno con su
enlace, sin rehacer el anterior.»

**Demo (a quien ya tiene Dossier):**
1. Mostrar que `/portal/dossier` es ahora un **listado**.
2. **Duplicar** un dossier y cambiar el título: enlace nuevo, contenido copiado.
3. Publicar los dos y comprobar que tienen **enlaces distintos**.

4. Enseñar que uno puede tener el desglose **completo** y el otro solo los totales: el mismo
   negocio contado con dos niveles de detalle, según a quién se le enseñe.

**A quién se le propone.** No a todo el que tiene Dossier, sino a quien ya ha dado señales de
necesitar dos: el que pidió el documento para un banco y meses después lo quiere para un
proveedor, el que atiende a interlocutores en dos idiomas, el que tiene varias empresas y no puede
contarlas en el mismo papel. Ofrecerlo antes de que aparezca esa necesidad suele terminar en un no
que luego cuesta reabrir.

**Objeciones:**
- *«Con uno me arreglo.»* → Hasta el día en que haya que enseñar algo distinto a dos
  interlocutores a la vez: rehacer el único cuesta más que tener dos.
- *«Puedo cambiar el que tengo cuando lo necesite.»* → Se puede, pero el enlace ya repartido pasa a
  enseñar el documento nuevo. Quien vuelva a mirarlo verá otra cosa de la que se le enseñó, y eso
  no se puede deshacer.
- *«¿Y si luego bajo de nivel?»* → Los dossiers no se pierden: se conservan, se siguen viendo y se
  siguen editando. Lo que vuelve al tope del nivel es la capacidad de crear más.

### 9. Cuántos caben
> etiquetas: vender · básico

- **No se compra aparte.** Cuántos dossiers caben es un tope del **nivel** contratado.
- **Requiere el Dossier.** Sin la funcionalidad contratada no hay nada de lo que tener varios.
- Se amplía **subiendo de nivel**, no activando nada.

```claux:limites:dossiers
Dossiers por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

Es de **alcance pequeño y deliberado**: no incorpora funciones al dossier, solo dice **cuántos
caben**. El modelo de datos siempre contempló varios; lo que se vende es el sitio para tenerlos. Al
llegar al tope, los ya creados siguen consultándose, editándose y publicados.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No me deja crear otro dossier.»** → O ha llegado al **tope de su nivel**, o no tiene el
  **Dossier** contratado. El mensaje del portal distingue los dos casos.
- **«Dupliqué y el enlace es el mismo.»** → No debería: la copia nace **sin enlace** y obtiene el
  suyo al publicarse. Basta con publicar la copia.
- **«Bajé de nivel y perdí los dossiers.»** → No se pierden: siguen **viéndose, editándose y
  publicados**; lo que queda limitado es **crear** más.

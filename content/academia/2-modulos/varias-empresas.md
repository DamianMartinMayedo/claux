# Varias empresas

> Capacidad del nivel · **atraviesa todo el portal**: varias empresas bajo el mismo negocio, con
> su vista consolidada · no se compra aparte, el tope lo fija el nivel contratado

No es una página, sino la capacidad de llevar **más de una empresa** dentro del mismo CLAUX, con su
vista **consolidada**. Hasta 2026 se vendía como el addon «Multiempresa»; hoy cuántas caben lo dice
el **nivel**, igual que los productos o los trabajadores. El punto **6 es el corazón de la ficha**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**CLAUX lleva varias empresas o locales dentro de la misma cuenta —cada una con su facturación, su
nómina y sus terceros— y consulta los números de todas juntas cuando hace falta.**

### 2. Para quién
> etiquetas: usar · básico

Para el dueño con **más de una empresa**: dos MIPYME, una cadena de locales, un grupo que factura
con varias razones sociales. Cada empresa mantiene su contabilidad separada, pero hay **un solo
dueño y un solo sistema**.

### 3. El problema que resuelve
> etiquetas: usar · básico

Llevar dos negocios en dos instalaciones separadas impone un coste permanente que se paga en dos
monedas distintas. Una es el tiempo: entrar y salir de sistemas, mantener dos configuraciones,
recordar en cuál se estaba. La otra es la fiabilidad de la visión de conjunto: la suma de ambos
negocios acaba haciéndose a mano en una hoja, con cambios de moneda incluidos, y esa hoja envejece
desde el momento en que se cierra. CLAUX resuelve las dos al mantener la separación donde
importa —numeración, nómina, terceros— y eliminarla donde estorba: el acceso y el total.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

Lo que está en juego es una decisión estructural: qué pertenece a cada empresa y qué pertenece al
dueño.

```claux:flujo
```

**Cada empresa es una identidad completa.** Se da de alta con su nombre comercial y su **nombre
fiscal**, su identificación tributaria, su dirección y sus datos de contacto, su **logotipo** y un
**color** que la distingue de un vistazo en todo el portal. Sobre esa identidad se emiten sus
facturas: con sus propios **datos de pago** y su **pie de factura** —lo que cobra una empresa no
se ingresa en la cuenta de la otra— y con su **letra de facturación**, una sola letra de la A a la
Z que **no puede repetirse dentro del grupo**, que es lo que impide que dos empresas acaben
emitiendo la misma numeración.

**Cada empresa tiene su propia moneda funcional.** Es un dato obligatorio y no heredado: una puede
llevarse en pesos y otra en divisa, y cada documento nace en la moneda de la empresa en la que se
emite.

**Lo que vive dentro de cada una.** Sus facturas y su numeración, su nómina, sus almacenes y sus
existencias, y sus **clientes y proveedores** —cada tercero tiene ficha **por empresa**—.

**Reparto de acceso, empresa por empresa.** El administrador ve todas; al resto de usuarios se les
**asigna** explícitamente a cuáles entran, de modo que un encargado puede llevar un local sin ver
el resto del grupo. En los selectores del portal solo aparecen las empresas **activas**: archivar
una la retira de la operación diaria sin borrar su historial.

**Vista consolidada en Reportes.** El estado de resultados se lee por empresa o **sumando todas**,
en la moneda de configuración y con distintivo de consolidado, para responder a cuánto suma el
conjunto.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Siete reglas delimitan el reparto:

- **Cada empresa es un ámbito cerrado; el dueño es uno solo.** La facturación, la nómina y los
  terceros pertenecen a cada empresa y no se mezclan entre ellas. Lo compartido es el techo: el
  mismo CLAUX y el mismo acceso.
- **El consolidado no altera las cifras de nadie.** Suma sobre los datos nativos de cada empresa,
  convierte a la moneda de configuración solo lo que lo necesita y **lo señala expresamente**.
- **La nómina cubana se decide por empresa.** Una puede llevar el modelo MIPYME y otra no; cada
  una calcula conforme a su propia configuración fiscal.
- **No se abre una empresa sin monedas configuradas.** Toda operación —una venta, un gasto, una
  compra, un producto— cuelga de la empresa y necesita una moneda válida del negocio. Permitir el
  alta antes dejaría documentos cayendo en una moneda que el negocio no tiene, y eso descuadra
  saldos y reportes en silencio. La comprobación es solo al crear: editar una empresa existente
  nunca se bloquea por esto.
- **La letra de facturación es única en el grupo.** Si la letra elegida ya la lleva otra empresa,
  CLAUX lo rechaza y dice cuál la ocupa, en lugar de aceptarla y producir dos series iguales.
- **Un usuario sin empresas asignadas no ve ninguna.** El acceso a una empresa se concede, no se
  hereda: la asignación es explícita y la ausencia de asignación no es «todas», es ninguna.
- **Solo el administrador crea y edita empresas.** Un usuario corriente trabaja dentro de las suyas
  pero no puede dar de alta otra ni cambiar sus datos fiscales.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Llevar varias no ocupa una pantalla: **atraviesa el portal completo**, ampliando el alcance de los
módulos que ya estén contratados.

```claux:conexiones
```

Un negocio con **una sola empresa** —el caso habitual— funciona sin merma alguna: la capacidad se
limita a habilitar las demás y a añadir la lectura conjunta.

El alcance depende, por tanto, de lo que haya contratado: en **Contabilidad** separa la
facturación, los gastos y la tesorería de cada empresa y añade el consolidado; en **Inventario**,
los almacenes y las existencias; en **Personal**, las plantillas y las nóminas; en **Clientes y
proveedores**, la ficha por empresa con la opción de copiarla. Lo que **no** se separa por empresa
es lo que pertenece a la cuenta y no a ninguna de ellas: las **monedas y sus tasas**, la
**dirección web pública**, el **catálogo**, las **reservas y citas**, y los **avisos** de la
bandeja. Un negocio con dos empresas no tiene dos cartas ni dos agendas.

También conviene saber qué ocurre al revés: tener varias empresas **no** añade ningún módulo. Si
el negocio no tiene Inventario, la segunda empresa tampoco lo tendrá — lo contratado se aplica a
todas las empresas por igual, y el precio de los módulos no se multiplica por el número de
empresas.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Se **activa** desde la ficha del cliente.
2. Dar de alta la **segunda empresa** —y las siguientes— con sus datos y su letra de facturación.
3. Trabajar en cada una seleccionándola en el portal.
4. En **Reportes**, consultar cada empresa por separado o el **consolidado**.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Lleve sus dos o tres negocios en el mismo CLAUX, cada uno con lo suyo, y vea el
total de todos con un clic, sin entrar y salir de sistemas ni sumar a mano.»

**Demo (a un dueño con varias empresas):**
1. Mostrar el **cambio de empresa** dentro del mismo portal.
2. Emitir una factura en cada una: la **numeración es independiente**.
3. Abrir **Reportes** y pasar a **consolidado**: el total de ambas.

4. Enseñar el **reparto de acceso**: un encargado asignado a una sola empresa entra y no ve la
   otra. Es el argumento que cierra la venta a quien tiene socios distintos en cada negocio.

**A quién se le propone.** Al dueño con dos razones sociales —muy común cuando una parte del
negocio factura y otra no—, al que abrió una segunda línea de actividad, y al que lleva un negocio
propio y otro de un familiar en el mismo sistema. La señal a la que hay que estar atento en la
visita es sencilla: cuando el dueño dice «esto lo llevo aparte».

**Objeciones:**
- *«Puedo tener dos cuentas separadas.»* → Dos cuentas no se suman solas ni comparten acceso;
  aquí es un único sistema y el consolidado viene hecho. Y se paga una vez, no dos.
- *«Solo tengo una empresa.»* → Entonces todavía no lo necesita; el día que abra la segunda, se
  activa sin rehacer nada.
- *«¿Tengo que pagar los módulos otra vez por la segunda empresa?»* → No. Lo contratado vale para
  todas las empresas: se paga por módulo, nunca por empresa.
- *«¿Y si mi socio no debe ver el otro negocio?»* → Cada usuario se asigna a las empresas que le
  correspondan, y no ve nada de las demás.

### 9. Cuántas caben
> etiquetas: vender · básico

- **No se compra aparte.** El número de empresas es un tope del **nivel** contratado, como el de
  productos o el de trabajadores.
- Se amplía **subiendo de nivel**, no activando nada. El CLAUX existente sigue igual y ninguna
  empresa cambia por dentro.
- Cuando el tope se llena, el portal lo dice donde ocurre —al intentar crear la siguiente— y ofrece
  hablar de subir de nivel. Nada se corta ni se archiva solo.

```claux:limites:empresas
Empresas por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

La lógica **ya está construida** en el portal —selección de empresa y consolidado—; lo que el
nivel decide es **cuántas caben**. El consolidado es una **vista de referencia**, no una
contabilidad de grupo: suma sobre datos nativos con la conversión señalada, y al sumar sin más una
operación **entre dos empresas del propio grupo cuenta en las dos**. Responde a «cuánto suma
todo», no sustituye a una consolidación formal con eliminación de saldos recíprocos. Tampoco
existe una **ficha de tercero de grupo**: un mismo proveedor que sirve a dos empresas se da de alta
en cada una.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No puedo dar de alta otra empresa.»** → Ha llegado al **tope de su nivel**. Se ve en la ficha
  del cliente (su nivel y sus ampliaciones a medida); se resuelve subiendo de nivel o, si es un caso
  puntual, con un tope propio para ese cliente.
- **«El consolidado no cuadra con la suma que hice.»** → Casi siempre es la **conversión de
  moneda**: el consolidado se expresa en la moneda de configuración y convierte a la tasa vigente
  lo que no esté en ella, indicándolo.
- **«Un cliente aparece en la empresa que no es.»** → Cada tercero tiene **ficha por empresa**;
  conviene comprobar en qué empresa se está y no buscarlo por nombre entre empresas.

# Parte IV — Poner en marcha y sostener

> etiquetas: operar · básico

Vender es la mitad. La otra mitad empieza cuando el cliente dice que sí: hay que dejarle el sistema
montado, incorporar lo que ya tenía, enseñar a su gente a usarlo y sostenerlo mes a mes. Esta
parte describe ese trabajo tal y como se hace hoy —con qué pantallas, en qué orden y con qué
precauciones— y es la única del manual que **no sale del equipo**: el partner vende y acompaña; la
instalación, el cobro y el soporte los lleva CLAUX.

```claux:flujo:alta
```

---

## 1 — De la firma al primer día

### 1.1 Las cuatro fases de una instalación
> etiquetas: operar · básico

El presupuesto que se le enseñó al cliente ya declaró qué fases se le iban a hacer, y esas fases son
literalmente el plan de trabajo:

1. **Alta y configuración.** Crear la cuenta, sus empresas, sus monedas y sus usuarios, y dejar cada
   módulo contratado con sus datos maestros mínimos.
2. **Migración de datos.** Traer lo que el negocio ya tenía: catálogo, clientes, proveedores,
   personal, existencias y el histórico de gastos y cobros.
3. **Formación.** Enseñar a trabajar con el sistema, **con los datos del propio negocio ya dentro**.
4. **Validación y cierre.** Acompañar los primeros días reales y corregir lo que se vea.

Una fase desmarcada en el presupuesto no se hace y no se cobra. Un negocio que abre de cero no tiene
nada que migrar; hay clientes que no quieren formación. Conviene mirar qué se marcó antes de
prometer nada en la primera visita de instalación.

### 1.2 El alta: qué se crea y en qué estado nace
> etiquetas: operar · básico

El alta se abre desde el presupuesto aprobado, y llega con **los módulos y el nivel ya marcados**.
Es deliberado: volver a elegirlos a mano es la vía más fácil de que el cliente acabe contratando
algo distinto de lo que se le enseñó en el papel. Si hubiera que corregir el nivel, se corrige aquí
y la cuota se recalcula sola —pero conviene mirar antes qué nivel proponía el presupuesto y por qué.

Lo que se rellena en el alta y conviene no dejar para después:

- **El sector.** No es una etiqueta decorativa: de él salen las palabras que el dueño va a ver en su
  portal —Menú o Catálogo, Mesa o Profesional o Cabina, Bonos o Membresías— y las filas sugeridas de
  su estado de resultados. Cambiarlo más tarde se puede, pero el negocio ya habrá aprendido unas
  palabras y verá otras.
- **Las empresas.** Si el negocio lleva dos razones sociales, se crean desde el principio: repartir
  después un histórico que nació en una sola es trabajo manual.
- **El contacto y el correo del administrador.** Ahí llegan la contraseña temporal y todos los avisos
  de vencimiento.

La cuenta **nace sin acceso**: suspendida si es un cliente de pago, o en prueba si se pactó una
prueba gratuita. Nunca nace activa. La razón es de cobro, no técnica: una cuenta que se abre antes
de cobrar es una cuenta que se olvida de cobrar.

### 1.3 Entrar al portal del cliente sin su contraseña
> etiquetas: operar · básico

La instalación es **llave en mano**: no se le manda al dueño una lista de ajustes que configurar. Desde
la ficha del cliente, el equipo entra a su portal como administrador del negocio, sin pedirle ni
conocer su contraseña.

Cómo se comporta:

- La sesión **dura cuatro horas** y luego caduca sola.
- Mientras dura, el portal enseña **un aviso permanente** de que se está dentro de la cuenta de un
  cliente, con el botón de salir. No hay forma de olvidarse.
- **Cada entrada queda registrada** en el registro de actividad, con quién entró y cuándo.
- Esas sesiones **no cuentan** en las métricas de uso del cliente. Si contaran, un negocio que no
  abre el portal parecería activo solo porque lo estuvo configurando el equipo.

Es también la puerta del asistente de importación en su versión completa: traer los datos de otro
negocio es trabajo de instalación, no una opción del menú del cliente.

### 1.4 Qué se deja montado antes de la formación
> etiquetas: operar · avanzado

Una formación sobre un portal vacío no se retiene. El mínimo que debe estar dentro antes de sentarse
con el equipo del cliente:

- **Monedas y tasas**, con los pares que el negocio usa de verdad y la fuente de cada tasa decidida.
  Un negocio que cobra en dos monedas y no las tiene configuradas no puede facturar.
- **Las categorías de gasto**, con su papel en el estado de resultados ya decidido. Es la decisión
  que más cuesta corregir después, porque recategorizar un histórico se hace fila a fila.
- **Los usuarios y sus permisos**, incluido quién es solo lectura. El dueño suele querer que el
  contador vea y no toque.
- **Un dato real de cada cosa**: un producto, un cliente, un empleado. Lo suficiente para que las
  pantallas no estén en blanco durante la formación.

---

## 2 — Traer los datos de antes

```claux:flujo:migracion
```

### 2.1 Dos caminos, según quién lo hace
> etiquetas: operar · básico

La misma maquinaria tiene dos puertas:

- **La del equipo**, dentro de la sesión de configuración del cliente. Es la completa y la que se usa
  en una instalación normal.
- **La del propio cliente**, en su portal, más guiada y con más avisos. Se abre por usuario —el dueño
  decide a quién se lo da— y solo ofrece los módulos que el negocio ya contrató.

Cuál se usa se decide en el alta, marcando en la ficha del cliente si tiene datos previos, si los
trae él o si los trae el equipo. De esa marca depende que su portal le enseñe o no la invitación a
traer sus datos el primer día, y que pueda pedirnos ayuda con un botón.

### 2.2 Qué se puede traer
> etiquetas: operar · básico

Clientes y proveedores · catálogo de productos · servicios · menú o carta · profesionales · personal ·
existencias iniciales · saldos de caja · gastos · cobros · acuerdos de servicios recurrentes.

Y lo que **no** se trae, dicho antes de que el cliente lo pregunte: **facturas y nóminas no se
importan**. El histórico financiero entra como gastos y cobros, que es lo que hace falta para que las
cuentas cuadren; los documentos de antes se quedan donde estaban. Las **fotos** del catálogo tampoco
entran: se suben después.

### 2.3 Las cuatro garantías del asistente
> etiquetas: operar · avanzado

Son las que permiten trabajar sin miedo sobre los datos de un negocio real:

1. **Repetir no duplica.** Cada fila se reconoce por una clave propia de su tipo, así que reintentar
   un lote no reescribe nada y volver a subir el mismo archivo se detecta. En un histórico de
   existencias o de cobros, duplicar es el destrozo más caro de deshacer.
2. **Actualizar no vacía.** Solo se escriben las columnas que el archivo trae. Un campo que el
   cliente no puso se queda como estaba, en vez de borrarse contra un valor por defecto.
3. **La ambigüedad se pregunta, no se adivina.** Lo que el cliente teclea no es un identificador:
   escribe «Comercial SA» donde su ficha dice «Comercial S.A.». El asistente perdona lo mecánico
   —mayúsculas, tildes, puntuación, espacios de más— y ahí se detiene: si hay varias fichas
   candidatas o una que solo se parece, la fila espera decisión. Emparejar por parecido a ciegas
   metería el dinero en la partida equivocada, en silencio y en un histórico entero.
4. **Se prueba antes de escribir.** La prueba enseña los totales por moneda, y esa es la única
   comprobación que caza un decimal mal leído a tiempo. Conviene mirarla siempre contra lo que el
   dueño diga que suman sus papeles.

### 2.4 Deshacer, y qué significa deshacer
> etiquetas: operar · avanzado

Un lote se puede deshacer, pero no significa lo mismo en todas partes:

- En los **maestros** —clientes, productos, personal— se retira lo insertado, y el sistema **se niega
  si algo de eso ya se está usando**. Borrar un producto que ya tiene un movimiento dejaría el
  movimiento huérfano.
- En el **dinero** no se borra nunca: se compensa con un movimiento de reverso. Un libro contable no
  se corrige a gomazos.

### 2.5 El histórico y la cuenta de Apertura
> etiquetas: operar · avanzado

Es la parte que más se malinterpreta, y conviene entenderla antes de importar el primer histórico.

Lo que el negocio **debe o le deben** entra como pendiente y aparece en cuentas por pagar y por
cobrar, como cualquier deuda viva. Lo que **ya estaba pagado** también entra —hace falta para el
estado de resultados— pero saldarlo contra una cuenta de tesorería real metería en la caja de hoy
dinero que se movió hace ocho meses. Por eso se salda contra una cuenta técnica de **Apertura**, una
por empresa y moneda, que el sistema crea sola.

Esa cuenta queda **fuera** de los saldos de tesorería, de la caja del dashboard, del flujo de caja y
de los selectores de pago y cobro. El resultado es el que se busca: **el estado de resultados cuadra
por fecha y la caja real no se toca**.

### 2.6 Lo que sale mal con el archivo del cliente
> etiquetas: operar · avanzado

Casi todos los problemas de una migración son del archivo, no del sistema:

- **CSV en vez de Excel.** Abierto en un Excel en español devuelve acentos rotos y convierte «1.500»
  en 1,50. Se pide Excel siempre que se pueda.
- **La fila de ejemplo de la plantilla sin borrar.** El cliente rellena debajo. El asistente la
  reconoce y la rechaza, pero deja de detectarla en cuanto el cliente escribe algo propio encima.
- **Cientos de nombres que no casan.** Por encima de cincuenta incompatibilidades el asistente deja
  de ofrecer el cotejo uno a uno y enseña un resumen agrupado por causa: a partir de ahí sale más
  barato corregir el archivo de origen que vincular nombres a mano.
- **Categorías archivadas con el mismo nombre.** Se reactivan y se marcan como tales, en vez de
  chocar contra un nombre repetido.

---

## 3 — La vida del cliente en el panel

```claux:flujo:ciclo-cliente
```

### 3.1 Los estados y qué significa cada uno
> etiquetas: operar · básico

| Estado | Qué quiere decir | El portal |
|---|---|---|
| **Activo** | Cliente de pago con período vigente | Abre |
| **Trial** | Prueba gratuita pactada, con fecha de fin | Abre |
| **Período especial** | Se le ha dado plazo a mano, con motivo escrito | Abre |
| **Suspendido** | Como nace, y donde vuelve si deja de pagar | No abre |
| **Vencido** | Estado antiguo, ya no se genera solo | No abre |

Dos cosas que cambian de sitio el estado **sin que nadie las toque**: un período especial que llega a
su fecha de fin y una fecha de vencimiento que pasa. En los dos casos la cuenta queda suspendida y
queda anotado en el registro de actividad que lo hizo el sistema, no una persona.

### 3.2 El período especial
> etiquetas: operar · básico

Es la herramienta para el cliente que va a pagar pero todavía no ha pagado. Se concede desde su ficha
con **fecha de fin, motivo y notas**, y todo eso se queda escrito.

Que el motivo sea obligatorio no es burocracia: el que concede el plazo y el que tres semanas después
tiene que llamar para cobrar no siempre son la misma persona, y «se le dio hasta el 15» sin más es
una conversación que empieza de cero.

### 3.3 Registrar un cobro
> etiquetas: operar · básico

Es la operación que **abre y reabre** el acceso, así que conviene hacerla bien:

- El importe **se sugiere solo** a partir de la cuota del cliente y su ciclo —mensual o anual, con su
  descuento— y se puede corregir.
- El período **empieza el día siguiente al vencimiento actual**, no hoy. Un cliente que paga tres días
  tarde no pierde tres días de suscripción.
- Al confirmarlo, la fecha de vencimiento pasa a ser el fin del período pagado y **la cuenta se
  reactiva** si estaba suspendida, vencida, en prueba o en período especial.
- Registrar el pago **calla los avisos** de vencimiento de ese cliente, en su bandeja y en la bandeja interna.

### 3.4 Qué ve el cliente cuando se le corta
> etiquetas: operar · básico

Una pantalla que dice que la cuenta está suspendida, que **sus datos siguen ahí** y un botón para
pedir la renovación. Ese botón no abre un correo: **registra la petición en el panel** y nos avisa.
La dirección de contacto se enseña igualmente debajo, para quien prefiera escribir.

Merece la pena decírselo al cliente antes de que ocurra. Un dueño que se encuentra el portal cerrado
sin haberlo oído nunca supone que ha perdido su trabajo, y la llamada empieza mucho peor.

### 3.5 Ampliar a un cliente que ya lo es
> etiquetas: operar · básico

Hay **dos maneras de ampliar**, y no se confunden: darle **otro módulo** —una capacidad que no
tenía— o **subirlo de nivel** —el mismo sistema, con más sitio dentro—.

Un módulo se activa o se desactiva desde la ficha del cliente, y **la cuota se recalcula sola** con
los precios del catálogo. No hay que teclear el precio nuevo.

El nivel se cambia en esa misma ficha, y la cuota se recalcula igual: todos los módulos pasan a la
columna de precio del nivel nuevo. Antes de proponerlo conviene mirar la tarjeta **«Capacidad del
nivel»**, que enseña dimensión a dimensión cuánto lleva usado de cuánto: es lo que contesta *a quién
le vendo el siguiente nivel* sin tener que preguntárselo.

**Bajar** también se puede y tampoco rompe nada —nadie pierde datos—, pero deja al cliente sin poder
añadir donde ya se pasa. Al elegir un nivel más bajo, la pantalla avisa de cuáles quedarían por
encima. Se dice antes de guardar, no después.

Y si lo que hace falta es **un hueco más en una sola cosa** —una empresa, dos usuarios—, ese tope
suelto se sube desde la misma tarjeta de capacidad, **con motivo escrito**, sin mover el nivel ni la
cuota. Es la excepción, no la costumbre: un tope regalado sin motivo es una venta que no se hizo.

El cliente también puede pedirlo él: en su portal, los módulos que no tiene aparecen con un «Me
interesa», y cuando algo se le está llenando le sale un **«Subir de nivel»** que entra por la misma
vía. Todo llega al panel como una solicitud más, en la misma bandeja que los interesados que vienen
de la web. Es la vía natural de crecimiento de la cuenta y conviene revisarla igual que se revisan
los leads.

### 3.6 Quién puede hacer qué dentro del equipo
> etiquetas: operar · avanzado

Hay dos roles: **super administrador**, que lo ve todo, y **vendedor**, al que se le marcan secciones
una a una. Un vendedor nace con solicitudes, presupuestos y clientes en solo lectura, y desde ahí se
le abre lo que haga falta.

La distinción importante: **clientes en solo lectura** y **clientes con gestión completa** son dos
permisos distintos. El primero deja consultar la cartera; el segundo deja tocar estados, módulos y
plazos. Quien vende no necesita el segundo.

---

## 4 — Sostener

### 4.1 Soporte por síntoma: cómo se usa este manual con el cliente al teléfono
> etiquetas: operar · básico

Cada ficha de la Parte II termina con un apartado de **soporte por síntoma**: la lista de lo que un
cliente dice cuando algo no le sale, con la causa real y la salida. Está escrito con las palabras del
dueño —«no me aparece», «me sale distinto»—, no con las del sistema, precisamente para poder buscarlo
mientras habla.

El orden que funciona en una llamada:

1. **Qué módulo es.** Si el síntoma cruza módulos, el diagrama de conexiones de la ficha dice quién
   alimenta a quién.
2. **Buscar el síntoma en su ficha**, con el buscador de este manual.
3. **Comprobar el alcance honesto** antes de tratarlo como avería. Una parte de las llamadas son
   cosas que el sistema no hace, y la respuesta correcta es decirlo, no buscar el fallo.
4. **Comprobar el módulo contratado.** Lo que no se contrató no se ve, y no se ve **sin candados**:
   el dueño no ve una pantalla bloqueada, no ve nada. «Me ha desaparecido» suele ser eso.

### 4.2 La bandeja de soporte
> etiquetas: operar · básico

Los mensajes del cliente llegan al panel con tres estados: **nuevo, leído y resuelto**. Responder
desde ahí marca el mensaje como resuelto y **le manda la respuesta por correo**.

Conviene respetar el estado como cola de trabajo compartida: está a la vista de todo el equipo, y
marcar leído es la señal de que alguien ya lo está mirando.

### 4.3 Lo que el sistema vigila solo
> etiquetas: operar · avanzado

Una vez al día, y sin que nadie lo pida, el sistema recorre los clientes y genera:

- **Aviso de vencimiento al cliente**, por correo, unos días antes —cuántos se configura en el panel—.
- **Avisos internos en la bandeja del equipo**: interesado sin contactar, mensaje de soporte sin responder,
  cliente por vencer (escalando conforme se acerca la fecha), cliente vencido, fin de prueba,
  **cliente inactivo treinta días** y correos que no salieron.
- **Los avisos internos del propio negocio**, que son otra cosa: los que ve el dueño en su portal
  sobre sus deudas, su stock o su caja sin cerrar.
- **Los avisos de tope**, que van al portal del dueño, no a la bandeja del equipo: al **90 %** de
  cualquier tope de su nivel le aparece un aviso, y al **100 %** además le llega un correo. Se manda
  una vez por dimensión y mes. En el panel, la tarjeta «Capacidad del nivel» de su ficha enseña lo
  mismo desde dentro —conviene mirarla antes de llamar, porque un cliente al 90 % es la conversación
  de venta más fácil que hay.

Dos de esos avisos son los que más dinero salvan: **cliente por vencer**, que evita la suspensión, y
**cliente inactivo treinta días**, que es la señal temprana de una baja. Un negocio que dejó de entrar
no avisa: simplemente no renueva.

### 4.4 El registro de actividad
> etiquetas: operar · avanzado

Queda constancia de quién hizo qué: altas, cambios de estado, plazos concedidos, pagos, entradas al
portal de un cliente. Se consulta desde el panel.

Sirve para dos cosas muy concretas: reconstruir qué pasó cuando un cliente reclama algo, y comprobar
si un cambio lo hizo una persona o lo hizo el barrido automático. Los dos casos aparecen antes de lo
que uno espera.

---

## 5 — Saber si lo están usando

### 5.1 Qué se mide
> etiquetas: operar · básico

El panel lo mide en dos vistas. **General**: adopción de cada módulo, negocios y usuarios activos a
siete y a treinta días, módulos más usados, uso de la IA y reparto por sector. **Por cliente**: sus
usuarios con su último acceso, cuántos registros ha creado en cada módulo y qué módulos toca de
verdad.

Las sesiones en las que el equipo entra a configurar **no cuentan**, a propósito.

### 5.2 Qué hacer con eso
> etiquetas: operar · avanzado

Tres lecturas que se repiten y qué significan:

- **Un módulo contratado con cero registros al mes de la instalación.** Casi nunca es que no sirva:
  es que la formación no llegó a esa persona, o que el dato de partida no se migró. Se resuelve con
  una llamada, no bajando la cuota.
- **Un solo usuario activo en un negocio con cinco.** El dueño está tecleando lo que debería teclear
  su equipo. Es la causa más común de abandono a los tres meses.
- **Treinta días sin entrar.** Se trata como una baja en curso, no como un cliente tranquilo.

Y la lectura que sirve para vender: un negocio que usa a fondo dos módulos es el candidato natural al
tercero, y la ampliación se propone desde lo que ya hace, no desde el catálogo.

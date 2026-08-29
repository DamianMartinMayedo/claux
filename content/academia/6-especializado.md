# Parte V — Especializado

> etiquetas: operar · avanzado

Las partes anteriores bastan para explicar CLAUX, venderlo y ponerlo en marcha. Esta llega al fondo
de dos asuntos que no caben en una ficha —**la norma fiscal cubana** aplicada a la nómina y **cómo
está montado el sistema por dentro**— y guarda al final lo que **no sale del equipo**.

No hace falta leerla entera ni de una vez. Es material de consulta: se viene aquí cuando un contador
pregunta por un número concreto, cuando hay que explicar por qué el sistema se comporta como se
comporta, o antes de una conversación de precio.

---

## 1 — La nómina cubana, por dentro

```claux:flujo:nomina-cuba
```

### 1.1 Los tres cubos, y por qué son tres
> etiquetas: operar · avanzado

Casi todos los malentendidos con un contador vienen de mezclar tres cosas distintas:

- **Devengado.** Lo que el trabajador gana: su salario del período más todo lo que se le suma
  (nocturnidad, feriados, pago extra, vacaciones disfrutadas) menos lo que se le ajusta por días no
  trabajados.
- **Retenciones.** Lo que se le descuenta al trabajador de ese devengado. **No es un ahorro de la
  empresa**: es dinero del trabajador que la empresa ingresa por él a la agencia tributaria. El
  trabajador cobra menos; a la empresa le cuesta exactamente igual.
- **Aportes de empresa.** Lo que la empresa paga **por encima** del devengado, sin descontárselo a
  nadie. Es coste puro y no aparece en el recibo como descuento.

De ahí sale la regla que hay que saber decir de memoria: **el coste de personal es el devengado más
los aportes, nunca el neto**. Un negocio que mira lo que sale de la caja y lo llama «lo que me cuesta
la plantilla» se está engañando con la cifra de las retenciones.

### 1.2 Los cinco tributos
> etiquetas: operar · avanzado

| Tributo | Lo paga | Qué es |
|---|---|---|
| Impuesto sobre ingresos personales | El trabajador | Se retiene del devengado, por tramos |
| Contribución Especial a la Seguridad Social | El trabajador | Se retiene del devengado |
| Impuesto por la Utilización de la Fuerza de Trabajo | La empresa | Aporte sobre la base del período |
| Contribución a la Seguridad Social (12,5 %) | La empresa | Aporte |
| Contribución a la Seguridad Social (1,5 %) | La empresa | Aporte |

Los dos primeros bajan el neto del trabajador. Los tres últimos no lo tocan y suben el coste de la
empresa. Cada uno sale con su nombre completo en el recibo y en el Excel; en la tabla de pantalla se
abrevian por espacio, pero el documento que se le entrega a alguien lleva siempre el nombre entero.

### 1.3 A los socios no se les retiene la Contribución Especial
> etiquetas: operar · avanzado

Es la excepción que más veces se ha explicado. Un socio de la MIPYME **no** paga la Contribución
Especial a la Seguridad Social; todo lo demás se le calcula igual que a cualquier trabajador.

En el sistema es una casilla de la ficha de la persona, y solo aparece en las empresas que trabajan
con el modelo cubano. Marcarla mal tiene consecuencias en las dos direcciones: sin marcar, se le
retiene a un socio algo que por norma no le toca; marcada de más, se deja de retener a quien sí debe.

### 1.4 Los tipos no están escritos en el programa
> etiquetas: operar · avanzado

Los porcentajes, los tramos y las bases de cada tributo son **datos con fecha de vigencia**, no algo
metido en el código. Dos consecuencias prácticas:

- **Un cambio de la ONAT no obliga a actualizar el sistema.** Se cierra la vigencia anterior y se
  abre la nueva.
- **Recalcular un mes viejo aplica la ley de ese mes.** Rehacer marzo en julio no le mete los tipos
  de julio. El resultado, además, queda congelado en la nómina: lo que se calculó, calculado está.

Solo un cambio en la **estructura** de un tributo —una lógica de tramo distinta, no un porcentaje
distinto— obligaría a tocar el sistema.

### 1.5 Días trabajados y prorrateo
> etiquetas: operar · avanzado

El bloque fiscal cuelga entero de una cifra: **cuántos días trabajó la persona en el período**. Sin
ella, quien entró el día 20 cobraría el mes completo con sus tributos inflados.

El sistema la propone —de la fecha de alta o de baja, o de los turnos que esa persona tiene
asignados— y **propone, no decide**: sale como un aviso en la hoja de nómina con un botón que rellena
los días y recalcula. El motivo se ve al pasar por encima de la casilla («causó baja el 5 de
agosto»).

El ajuste por días **no reescribe el salario del contrato**: entra como una línea propia, normalmente
negativa. Es lo que permite mirar un recibo y saber por qué esa persona cobró menos.

### 1.6 Vacaciones: se acumulan, se disfrutan y se liquidan
> etiquetas: operar · avanzado

Son tres momentos distintos y conviene no confundirlos:

- **Se acumulan** cada mes, en importe y en días, sobre el devengado y los días efectivamente
  trabajados. Ese es el momento en que la empresa **reconoce el coste**, aunque no salga dinero.
- **Se disfrutan**: la persona coge días y se le pagan. Sale el dinero, pero **no vuelve a ser coste**
  —ya se contó al acumularlo— y por eso el coste del mes descuenta las vacaciones disfrutadas.
- **Se liquidan** al causar baja: el saldo pendiente se paga de golpe.

El día de vacaciones se valora al **promedio del saldo acumulado**, no al salario del último mes: es
lo que evita que un aumento reciente revalorice hacia atrás días ganados con otro sueldo.

La liquidación tiene un tratamiento fiscal propio, cerrado con la asesoría: **entra en el devengado**
y **está sujeta a las retenciones del trabajador**, pero **no entra en la base de los aportes de
empresa**.

### 1.7 Subsidios: el trabajador cobra y a la empresa no le cuesta
> etiquetas: operar · avanzado

Un subsidio lo cobra el trabajador, pero la empresa lo recupera de la Seguridad Social. Es el caso
que rompe la costumbre de tratar gasto y deuda como el mismo número: hay dinero que sale y no hay
coste.

Por eso el subsidio va por su lado, como un **cobro pendiente** de la empresa, y **no cuenta como
ingreso** del negocio. Tampoco se compensa contra la contribución a la Seguridad Social: se cobra
aparte.

### 1.8 Cómo se redondea, y por qué se nota
> etiquetas: operar · avanzado

Todo importe del módulo de personal —salarios, devengados, retenciones, netos, aportes, tramos,
coste— pasa por **una sola regla**: se trabaja con tres decimales de base y se redondea a dos al
final.

Es un criterio decidido con la asesoría, no una casualidad del programa. Importa saberlo por una
razón muy concreta: cuando un contador rehace una nómina a mano en una hoja de cálculo y le sale un
céntimo de diferencia, casi siempre es esto y no un error.

Fuera del módulo de personal el redondeo es el normal. La regla de los tres decimales es de la
nómina y solo de la nómina.

### 1.9 Qué escribe en los libros confirmar una nómina
> etiquetas: operar · avanzado

Confirmar no es un cambio de estado: es lo que mete la nómina en la contabilidad, y escribe **varias
filas**, no una. En resumen:

- El **salario devengado** (descontadas las vacaciones disfrutadas) y la **acumulación de vacaciones
  del mes** son coste y no generan deuda con nadie.
- Los **aportes de empresa** son coste **y** deuda: hay un acreedor real esperando cobrar.
- El **neto del trabajador** y **cada retención** son deuda sin coste: su coste ya está dentro del
  devengado. Van en filas separadas porque cada acreedor tiene su propio vencimiento, y pagarle a la
  plantilla no puede pagar los impuestos de paso.

Confirmar es lo único irreversible del módulo, y el sistema **enseña antes la lista exacta de lo que
va a escribir**. Merece la pena leerla con el cliente la primera vez: es la conversación que explica
de una vez por qué el coste no es el neto.

### 1.10 Lo que la nómina no hace
> etiquetas: operar · básico

- **No presenta declaraciones.** Calcula, deja la deuda registrada con su acreedor y saca los
  documentos; presentar es del cliente o de su contador.
- **El modelo cubano se activa por empresa, no por cliente**, y **solo actúa sobre nóminas en pesos**.
  Una ficha en divisa no impide usarlo.
- **No hay anticipos** al día de hoy.
- **No se importan reglas, conceptos ni incidencias**: el asistente de importación todavía no cubre
  esa parte y se cargan a mano.

---

## 2 — Cómo está montado, sin ser programador

### 2.1 Un solo sistema para todos los negocios
> etiquetas: operar · avanzado

No hay una copia de CLAUX por cliente: hay **un sistema y una infraestructura**, y cada negocio es
configuración —sus datos, sus módulos, su sector, sus monedas—. De ahí salen tres cosas que se notan
en la venta:

- **Activar un módulo es inmediato.** No hay instalación ni despliegue; es una casilla en su ficha.
- **Toda mejora llega a todos.** Nadie se queda en una versión vieja.
- **Y nadie ve los datos de nadie.** Cada consulta del sistema está atada al negocio que la hace.

### 2.2 Los módulos son independientes de verdad
> etiquetas: operar · avanzado

Es una regla de diseño, no una promesa comercial: **cada módulo funciona solo**. Los demás, cuando
están, añaden **llenado rápido** —traer datos que ya existen en vez de teclearlos— pero nunca
condicionan lo básico.

Ejemplos que sirven en una visita: se puede llevar personal y nómina sin contabilidad (los apuntes se
escriben igual, y la interfaz no ofrece pantallas que ese cliente no tiene); se puede tener catálogo
digital sin inventario; se puede usar el dossier sin ningún otro módulo, rellenándolo a mano.

Lo que sí cambia sin el módulo vecino es la **comodidad**, y ahí es donde está el argumento de
ampliación: no «te falta algo», sino «esto que ahora tecleas dos veces dejaría de teclearse».

### 2.3 Varias empresas, varias monedas: qué se congela
> etiquetas: operar · avanzado

Un negocio puede llevar más de una razón social dentro de la misma cuenta, y cada documento pertenece
a una. Los importes viven **en la moneda en la que ocurrieron**, no convertidos.

La conversión es siempre una **vista**: «ver en» una moneda es una forma de mirar, no un cambio del
dato. Dos matices que hay que saber explicar:

- **Lo que se importa con su tasa se queda con su tasa.** Si al traer el histórico se declaró la tasa
  de cada fila, el estado de resultados usa esa, no la de hoy. Donde no la haya, cae a la vigente, y
  el documento lo dice con esas palabras.
- **El flujo de caja va siempre a tasa de hoy**, a propósito: mide el efectivo actual, no lo que valía
  aquel día.

### 2.4 Sin conexión: qué funciona y qué no
> etiquetas: operar · avanzado

Lo que funciona sin línea es **el punto de venta**: cobra, imprime y cierra caja, y transmite lo pendiente
cuando vuelve la conexión. También un **catálogo ya visitado** se sigue viendo.

El resto del portal necesita conexión. Decirlo claro en la visita evita la decepción del tercer día;
lo que sí se puede prometer es que el sistema está construido para conexiones malas —páginas ligeras,
descargas directas sin abrir ventanas nuevas, avisos de carga en todo lo que tarda—.

### 2.5 Dónde viven los datos
> etiquetas: operar · avanzado

**Fuera de Cuba**, en infraestructura de España y Estados Unidos, con copias gestionadas por el
proveedor de base de datos. Las llamadas a servicios de inteligencia artificial salen siempre del
servidor, nunca del móvil del cliente.

Y una consecuencia comercial que conviene tener presente: **CLAUX no procesa pagos**. El cobro al
negocio se gestiona fuera de la plataforma y el sistema solo refleja el estado. Lo mismo vale para el
cliente final del negocio: el sistema registra el cobro, no lo ejecuta.

---

## 3 — Lo que no sale del equipo

### 3.1 Dónde está el margen de una instalación
> etiquetas: confidencial · avanzado

El pago único de la puesta en marcha se calcula en **horas por tarifa**, y ahí hay dos palancas: la
**tarifa por hora**, negociable cliente a cliente, y el **descuento con motivo**, que queda escrito.
No hay recargos sueltos: todo son horas, precisamente para que el desglose se le pueda explicar al
cliente sin inventar nada.

El margen real de una instalación no se decide al presupuestar sino al ejecutar, y por eso cada
presupuesto guarda las **horas reales** junto a las estimadas. Las dos fuentes de desvío que se
repiten:

- **La migración.** Un archivo sucio multiplica las horas de la fase 2 sin cambiar el precio pactado.
  Pedir el archivo **antes** de cerrar el presupuesto es la mejor inversión de tiempo del proceso.
- **La formación que se repite.** Formar a quien no va a usar el sistema obliga a volver. Conviene
  pactar con el dueño quién se sienta.

La cuota mensual es otra cosa: sale del catálogo de módulos en vivo, **a la columna del nivel que
tenga ese cliente**, y **no se negocia por cuenta propia**. Si hay que mover el precio de una cuota,
se mueve en el catálogo, no en un cliente. Lo que sí es por cliente es el **descuento con fecha de
fin**, y para eso hay un campo.

### 3.2 Qué cuesta sostener la plataforma
> etiquetas: confidencial · avanzado

La estructura de coste, para poder razonar sobre un descuento sin tener que preguntar:

- **Coste fijo de infraestructura**, que no crece con cada cliente nuevo: es la misma instalación para
  todos y, mientras los volúmenes sean los de hoy, un cliente más no mueve la factura.
- **Coste variable de la inteligencia artificial**, que sí es por uso y por eso **tiene cupo mensual
  por nivel** —y es el único tope que sigue existiendo en Pro—. Es el único módulo con coste marginal
  apreciable, y el motivo de que no se regale.
- **Coste de las personas**: la instalación, la migración y el soporte. Es el grande, y es el que hay
  que mirar antes de rebajar un pago único.

Las cifras concretas no se escriben aquí: se consultan en el panel y en la contabilidad de CLAUX,
que es donde están al día. Un número tecleado en un manual envejece en silencio y acaba usándose en
una negociación.

### 3.3 El roadmap real
> etiquetas: confidencial · avanzado

Lo que está en camino, con el orden que tiene hoy. **No se anuncia fuera**: lo que se le dice a un
cliente es lo que el sistema hace hoy.

- **La capa pública del negocio, completa.** El catálogo, las reservas y las citas están en
  producción; falta terminar la mini-web (horarios, ubicación, fotos) y los apartados del bot que
  todavía son un esqueleto.
- **La ayuda pública del cliente**, derivada de estas mismas fichas.
- **Lotes y caducidad en inventario**, que es lo que hoy impide avisar de productos que vencen.
- **Importar reglas y conceptos de nómina**, la última pieza que se carga a mano en una migración.
- **Refuerzos de seguridad y de esquema** antes de crecer en número de clientes.

Regla que gobierna el orden: **ante la duda entre hacerlo perfecto y hacerlo vendible, vendible**,
sin saltarse los principios que evitarían rehacer la casa después.

### 3.4 Qué no se cuenta fuera
> etiquetas: confidencial · avanzado

Cuatro cosas, y la razón de cada una:

- **Márgenes y costes.** Un cliente que sabe el coste no negocia el precio: negocia el coste.
- **El roadmap sin anunciar.** Una fecha dicha en una visita se convierte en un compromiso, y un
  compromiso incumplido pesa más que la funcionalidad que faltaba.
- **Los datos y los nombres de otros clientes.** Ni como referencia, salvo permiso expreso.
- **Los detalles internos de cómo está hecho.** No por secreto, sino porque invitan a discusiones que
  no ayudan a decidir. Lo que el cliente necesita saber es qué hace el sistema y qué no.

# Servicios

> Módulo (clave interna `servicios`) · en el portal: **Servicios**, con **2 páginas** (Servicios
> y Suscripciones) · funciona solo

Dos páginas que resuelven un mismo asunto: el **catálogo de servicios** —lo que el negocio cobra
por hacer— y las **suscripciones** —los cobros que se repiten en el tiempo—.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**Servicios administra lo que el negocio cobra por prestar un trabajo o un acceso, en lugar de
por entregar una cosa, y sostiene la facturación recurrente: las suscripciones que dejan hecha
la factura cada período.**

### 2. Para quién
> etiquetas: usar · básico

Para negocios que **venden trabajo o acceso continuado**: consultorías, mantenimiento
informático, alojamiento web, gimnasios con membresías, academias, y en general cualquier
actividad con **cuota periódica**. La distinción operativa frente a un producto es que un
servicio **no consume existencias**: no se agota, se presta.

### 3. El problema que resuelve
> etiquetas: usar · básico

La facturación recurrente llevada a mano se degrada con el tiempo, y lo hace en silencio. El
cobro que no se emitió un mes no deja rastro en ninguna parte: no hay un hueco visible, solo un
ingreso que nunca llegó. A los tres meses nadie recuerda si aquel cliente pagó, pagó de más o
dejó de pagar, y reconstruirlo exige repasar el banco movimiento a movimiento. Servicios
invierte ese orden: el sistema **deja preparada la factura el día del ciclo**, mantiene el
estado real de cada acuerdo y presenta en una sola pantalla quién está al corriente y quién
acumula deuda.

---

## B — Cómo funciona

### 4. Qué hace — sus dos páginas
> etiquetas: usar · básico

El recorrido del módulo va del catálogo al cobro, y su punto característico es el paso
intermedio: el acuerdo, que es lo que convierte un precio suelto en un ingreso previsible.

```claux:flujo
```

**Servicios — el catálogo de lo que se cobra por hacer.** Fichas con **código** (SRV-),
**precio y coste por moneda** y proveedor asociado, **sin stock ni almacenes**. Las
**categorías** son propias del módulo y no se mezclan con las de productos. El catálogo se
enriquece con el uso real: cuando se pacta un precio en una moneda que ese servicio aún no
tenía, CLAUX ofrece incorporarlo. La ficha incluye además la pestaña **«Contratado por»**, que
reúne todos los precios a los que se está prestando el mismo servicio — de modo que una subida
de tarifa deja de decidirse a ciegas y pasa a apoyarse en la dispersión real de la cartera.

**Suscripciones — los acuerdos que facturan solos.** Un acuerdo recoge qué servicios se prestan
a un cliente —pueden ser **varios**—, a qué **precio mensual**, con qué **periodicidad**
(mensual, trimestral, anual…), en qué moneda, entre qué fechas y en qué estado. El listado
funciona como pantalla de trabajo: de cada acuerdo muestra el **último cobro** y el **importe
adeudado**, y permite filtrar por «con deuda». Sobre él operan las acciones de volumen
—**duplicar** un acuerdo, dar de alta **el mismo a varios clientes** de una vez, **subir tarifas
en lote** con el antes→después acuerdo a acuerdo—. La pestaña de **facturación del período** es
un **calendario de cobros**: una tarjeta por mes con su estado (pendiente de facturar ·
pendiente de emitir · pendiente de cobro · cobrado · previsto) y su factura asociada; los
atrasos se marcan **en el mes al que corresponden**, no se arrastran ni se disimulan. Un acuerdo
puede **pausarse y reanudarse**: los ciclos comprendidos en la pausa no se cobran, con el límite
de que nunca se condona más tiempo del que estuvo efectivamente parado.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cinco reglas gobiernan el módulo y explican la mayoría de sus comportamientos:

- **El precio se almacena siempre por mes.** El importe del ciclo —trimestre, año— lo calcula
  CLAUX. Así una cifra como «10.000 CUP» significa lo mismo con independencia de la
  periodicidad, y los acuerdos son comparables entre sí.
- **La factura se deja hecha, nunca emitida.** Llegado el día del ciclo, CLAUX prepara el
  **borrador**. La razón es asimétrica: un borrador con un precio equivocado se corrige, pero
  una factura ya emitida y numerada exige anulación formal. La emisión es siempre un acto
  humano, y admite hacerse en lote.
- **El estado «vencida» se deriva, no se marca.** Un acuerdo que alcanza su fecha de término
  pasa a vencido por sí mismo, de modo que la cifra de ingreso recurrente no queda inflada por
  acuerdos extinguidos.
- **Cambiar de moneda no arrastra el importe.** Diez mil de una divisa no son diez mil de otra:
  si el servicio tiene tarifa en la nueva moneda, se precarga; si no, el campo queda vacío y
  convertir por tasa es un **atajo opcional**, no un automatismo.
- **El descuento pertenece al servicio, no al acuerdo.** Un mismo cliente puede tener un
  servicio a tarifa plena y otro rebajado, y la rebaja se lee **en su propia línea**.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Servicios es un módulo emisor: produce facturación periódica que el resto del sistema recoge, y
comparte catálogo con las piezas que también prestan servicios.

```claux:conexiones
```

El módulo **opera de forma autónoma**: el catálogo, los acuerdos y el calendario de cobros
funcionan sin ninguna otra pieza contratada. Lo que añaden las demás es continuidad —que la
factura emitida siga su curso hasta el cobro, o que el mismo servicio pueda venderse por otro
canal—.

```claux:capas
```

> Nomenclatura: la etiqueta la fija el negocio. En un gimnasio son **«Membresías»**; en una
> peluquería, **«Bonos»**. Nunca «Contratos», término reservado a RRHH.

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Dar de alta los **servicios** con su precio por moneda.
2. Crear una **suscripción**: cliente, servicios, precio mensual, periodicidad y fecha de inicio.
3. Si el acuerdo arranca en el pasado, CLAUX deja listo el **primer cobro** al guardar.
4. Cada mes, revisar el **calendario de cobros** y **emitir** los borradores del período.
5. Consultar quién adeuda y registrar el cobro desde Cuentas por cobrar.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Sus cuotas se cobran solas. CLAUX deja la factura hecha cada mes y le dice quién
está al día y quién le debe, sin que se escape ninguno.»

**Demo:**
1. Crear un **servicio** y una **suscripción** mensual a un cliente.
2. Mostrar el **calendario de cobros**: el mes en curso ya tiene su cobro pendiente.
3. **Emitir** el borrador y verlo pasar a Cuentas por cobrar.
4. Enseñar la **subida de tarifas en lote** y la pestaña **«Contratado por»**.

**Objeciones:**
- *«Llevo mis cuotas en una hoja de cálculo.»* → La hoja no avisa, no deja la factura hecha y no
  totaliza la deuda. Aquí el mes solo se marca como cobrado cuando el cobro existe de verdad.
- *«¿Y si un cliente causa baja temporal?»* → Se pausa el acuerdo: los ciclos de la pausa no se
  cobran, y al reanudar no se facturan de golpe.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **El nivel también pone el techo de servicios del catálogo.** Cuenta las líneas activas del
  catálogo, no los servicios prestados en el mes: un salón que factura doscientas sesiones puede
  tener quince líneas.
- **Funciona solo.** Con Contabilidad, las facturas y los cobros se integran además en el informe.

```claux:limites:servicios
Servicios del catálogo por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

La facturación automática produce **borradores**, no emite: para numerar hace falta que la
empresa tenga **letra de facturación** configurada. El **tramo futuro del calendario es
informativo** —una proyección a doce meses—: no permite facturar por adelantado ni computa como
ingreso. Internamente los servicios comparten tabla con los productos, pero **su página es
propia** y no tienen existencias.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No se generan las facturas del mes.»** → La empresa carece de **letra de facturación**, y
  sin ella no hay con qué numerar. El propio calendario lo advierte.
- **«El mes figura como cobrado y no he cobrado.»** → Ese estado significa cobro registrado. Si
  quedaron borradores sin emitir, el mes lo desglosa aparte (facturado · cobrado · sin facturar).
- **«Reanudé un acuerdo y facturó varios meses de golpe.»** → Comportamiento ya corregido: los
  ciclos comprendidos en la pausa no se cobran. Conviene revisar las fechas de la pausa.
- **«Cambié la moneda y se vació el importe.»** → Es deliberado: el importe no se arrastra entre
  divisas. Se introduce el nuevo precio o se usa el atajo de convertir por tasa.

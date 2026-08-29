# RRHH

> Módulo (clave interna `rrhh`) · en el portal: **RRHH**, un grupo de **4 páginas** (Personal,
> Turnos, Nómina, Reportes) · funciona solo · con **nómina MIPYME
> cubana** opcional por empresa

Cuatro páginas articuladas alrededor de una pieza central, la **nómina**, que puede incorporar el
**cálculo fiscal cubano** —retenciones del trabajador y aportes de la empresa— actualizado. El
punto **4 recorre las cuatro páginas**.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**RRHH administra la plantilla: las fichas del personal, la rotación de turnos y la nómina
mensual** — y, cuando el negocio tributa en Cuba, calcula por sí mismo las retenciones que
soporta el trabajador y los aportes que la empresa paga por encima del salario.

### 2. Para quién
> etiquetas: usar · básico

Para cualquier negocio **con empleados**, desde tres personas hasta una plantilla amplia. Y de
manera muy particular para la **MIPYME cubana**, obligada a determinar y presentar cada mes la
CESS, el IRPF y los aportes a la Seguridad Social: un cálculo que a mano es lento, repetitivo y
propenso al error, y cuyo fallo tiene consecuencias ante la ONAT.

### 3. El problema que resuelve
> etiquetas: usar · básico

La nómina llevada en hoja de cálculo concentra dos riesgos. El primero es el error silencioso:
una fórmula copiada mal en una fila produce una retención incorrecta que nadie detecta hasta la
presentación. El segundo es más de fondo: la hoja no distingue entre lo que el trabajador cobra
y lo que el trabajador cuesta, de modo que el aporte de empresa —que es coste real y deuda con
un tercero— sencillamente no aparece por ningún lado. RRHH calcula el mes completo, emite el
**recibo** de cada trabajador y separa con claridad las tres magnitudes: lo devengado, lo
retenido y lo aportado.

---

## B — Cómo funciona

### 4. Qué hace — sus cuatro páginas
> etiquetas: usar · básico

Las cuatro páginas forman una secuencia: la ficha define las condiciones, los turnos aportan el
tiempo trabajado, la nómina lo convierte en dinero y los reportes lo agregan.

```claux:flujo
```

**Personal — la plantilla.** Fichas de empleado que incorporan **su contrato** (salario, tipo,
fechas), la **baja** cuando se produce y el **saldo de vacaciones**, llevado en días y en
dinero. Bajo el modelo cubano se indica además si la persona es **socio**, condición que la
excluye de la retención de CESS. Desde la propia ficha se consultan **sus nóminas** y se descarga
su **recibo** en PDF.

**Turnos — quién trabaja cuándo.** Se compone de tres piezas encadenadas: las **franjas**
(Mañana, Tarde, Noche, Descanso), los **patrones de rotación** —un ciclo semanal, quincenal,
mensual, o de N días de trabajo por M de descanso— y el **roster**, que asigna a cada empleado su
patrón y el punto del ciclo en que arranca. El **cuadrante** se genera a partir de esos tres
datos, con una **vista previa** por semana, quincena o mes que señala en ámbar los días en que
una misma persona quedaría cubierta por dos patrones.

**Nómina — el mes.** Una nómina corresponde a **una empresa, un mes y una moneda**, y permanece
en **borrador** hasta que se **confirma**. Cada línea —un trabajador— presenta su desglose
completo: los **devengos** (salario base más extras), las **retenciones** que se le descuentan y
los **aportes de empresa** que se pagan por encima del bruto. Lo variable del mes se introduce
como **incidencias** (días trabajados, nocturnidad, feriados…), mientras que los **conceptos
recurrentes** —un bono fijo, una retención pactada— se aplican solos al generar. La nómina puede
**recalcularse** con previsualización del antes→después. Al **confirmar**, se determina el
reparto y, si hay Contabilidad, se registran los gastos y las deudas correspondientes. Con el
**modelo MIPYME cubano** activo, CLAUX aplica los **tipos fiscales vigentes** —CESS, IRPF,
aportes a la Seguridad Social, UFT— conforme a la norma **de la fecha de esa nómina**, no de la
fecha de cálculo.

**Reportes — el estado de la plantilla.** Reúne el **coste de personal** por mes, por empresa y
**por cargo**; el **submayor de vacaciones** (saldo, acumulado y pagado); los **tributos de
nómina** del período desglosados por concepto; y los indicadores de plantilla —**coste medio por
persona, rotación y antigüedad**—. Todo con selector **«Ver en [moneda]»** —por defecto cada
moneda conserva sus datos reales— y descarga en **PDF y Excel**.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Cinco reglas gobiernan el módulo, y la primera es la que más malentendidos evita:

- **El coste de un trabajador es lo devengado, no el neto.** Una retención **no es un ahorro
  para la empresa**: el coste es idéntico, lo que cambia es que aparece un segundo acreedor —la
  agencia tributaria— en lugar de uno solo. Por eso se registra por separado y con su propio
  vencimiento.
- **Los tipos fiscales son datos, no fórmulas ocultas.** Cuando la ONAT modifica un tramo, se
  actualiza la tabla; recalcular marzo aplicará **la norma de marzo** aunque se ejecute en julio.
- **Bajo el modelo cubano, el resultado del cálculo es de solo lectura.** La CESS y el IRPF se
  derivan del devengado: permitir teclearlos a mano produciría recibos que se contradicen con su
  propia base. Lo que se edita son los **datos de entrada** —incidencias y conceptos—, nunca la
  cifra resultante.
- **Las vacaciones se acumulan y se liquidan.** El saldo se lleva en días y en dinero, cada
  nómina suma su parte y, al causar baja, CLAUX **propone** la liquidación del saldo pendiente
  sin decidirla por su cuenta.
- **Confirmar es la única operación irreversible, y aun así es reversible.** Antes de confirmar
  se listan las filas que se van a escribir; eliminar la nómina las revierte todas, con una
  salvaguarda si ya se registraron pagos contra ellas.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

RRHH es un módulo productor: consume poco del resto del sistema y entrega el gasto de personal
ya calculado, junto con la deuda que ese gasto genera frente a cada acreedor.

```claux:conexiones
```

El módulo **opera de forma autónoma**, incluso sin Contabilidad: en ese caso la interfaz se
ajusta y no ofrece pagos que no podría registrar. La nómina, los recibos y los reportes de coste
funcionan igual.

```claux:capas
```

### 7. Cómo se usa (primeros pasos)
> etiquetas: usar · básico

1. Dar de alta el **personal** con su contrato, a mano o con el importador.
2. *(Si se tributa en Cuba)* Activar el **modelo MIPYME** en la empresa y definir las **reglas**
   de retención una sola vez para toda la plantilla.
3. *(Opcional)* Montar los **turnos**: franjas, patrones y roster.
4. Cada mes: cargar las **incidencias**, **generar** la nómina, revisarla y **confirmarla**.
5. Descargar los **recibos** y pagar desde Tesorería. Consultar **Reportes** para el coste.

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «La nómina del mes, calculada sola — con las retenciones y los aportes que exige
la ONAT, el recibo de cada trabajador y el coste real para el negocio. Sin fórmulas copiadas ni
sobresaltos con Hacienda.»

**Demo:**
1. Dar de alta un trabajador con su salario.
2. **Generar** la nómina del mes y mostrar el **desglose**: devengado, retenciones, aportes.
3. Descargar su **recibo** en PDF.
4. Abrir **Reportes**: el coste de personal ya está calculado, por cargo y por mes.

**Objeciones:**
- *«Lo llevo en Excel.»* → Excel no conoce la norma cubana, no se actualiza cuando cambia un
  tramo y no avisa de un error en una celda. Aquí el cálculo es homogéneo para toda la plantilla
  y queda el recibo como constancia.
- *«Somos pocos.»* → El número de empleados no exime del cálculo ni de la presentación; y el
  sistema acompaña el crecimiento sin rehacer nada.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **El nivel también pone el techo de trabajadores.** Cuenta la plantilla activa —quien está de
  baja definitiva deja de contar—. Es el tope que más veces se queda corto, y por una razón
  concreta: en un negocio con temporada hay que preguntar por el **pico**, no por la plantilla de
  hoy.
- **Funciona solo.** El **modelo fiscal cubano** se activa **por empresa** —una puede llevarlo y
  otra no—. Con Contabilidad, los costes y las deudas de la nómina se incorporan al informe.

```claux:limites:trabajadores
Trabajadores por nivel
```

---

### Alcance honesto
> etiquetas: vender · básico

Es **nómina simple**, no un sistema integral de RRHH: no incluye control de fichaje, portal del
empleado ni gestión documental. El cálculo cubano es **mensual**, sin liquidación acumulada
anual. Los **anticipos** quedan fuera de alcance. Turnos es hoy **rotación generativa**: proyecta
el cuadrante, pero todavía no registra lo ocurrido día a día —las ausencias por fecha están en el
backlog—. Los tipos fiscales los fija y verifica **Claudia** contra la norma vigente, y se
implementan tal cual.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«El coste de personal me sale bajo.»** → Con casi total seguridad se está leyendo el **neto**.
  El coste es el **devengado**; las retenciones son deuda con la ONAT, no un ahorro. Reportes ya
  emplea el devengado.
- **«A un socio se le retuvo la CESS.»** → Falta marcarlo como **socio** en su ficha; la casilla
  solo aparece con el modelo cubano activo.
- **«Recalculé un mes antiguo y cambiaron las cifras.»** → Es lo correcto: se aplica la **norma
  de esa fecha** y los conceptos vigentes entonces. La previsualización muestra el antes→después
  antes de escribir nada.
- **«Confirmé y no aparece en Cuentas por pagar.»** → Ese cliente no tiene **Contabilidad**
  contratada; RRHH funciona igual, pero no existe dónde asentar la deuda. La interfaz lo indica.
- **«Alguien entró a mitad de mes y cobró el mes completo.»** → Faltan los **días trabajados**.
  Turnos los propone; en su defecto se cargan como incidencia.

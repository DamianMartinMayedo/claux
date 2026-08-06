# CLAUX — Cómo circula la información entre módulos

Para **analizar procesos sin tocar el código**: qué pasa de punta a punta cuando el
negocio hace algo, qué piezas participan y en qué orden.

`CONTEXTO.md` §2 describe **cada módulo por separado**. Este documento describe los
**recorridos que los cruzan**, que es donde están casi todos los malentendidos: un cobro
no vive en «Gastos y cobros», vive en el camino que va de la factura al dinero en la
cuenta. Aquí no se repite lo que dice §2 — se dice el orden y se apunta a dónde leerlo.

> **Cómo citar.** «PROCESOS › Una venta se convierte en dinero, paso 3». Cada proceso
> apunta al apartado de `CONTEXTO.md` §2 con el detalle y al fichero donde vive la regla.

---

## Las cuatro reglas que explican casi todo

Antes de los recorridos, porque se repiten en todos:

1. **Cada módulo funciona solo, y no hay módulo fundacional.** Contabilidad opera sin
   inventario, sin RRHH y sin caja, y ellos operan sin Contabilidad (su clave interna es
   `base` por historia; dejó de ser obligatoria hace tiempo). Cuando un módulo toca a otro, lo hace **añadiendo** (un resumen, un llenado
   rápido), nunca condicionando. Si un análisis concluye «para usar X hay que contratar
   Y», casi seguro es un fallo, no un diseño.
2. **En el libro no se borra, se compensa.** Los ledgers (tesorería, inventario) corrigen
   añadiendo un movimiento contrario. Lo que sí se borra son fichas de maestro.
3. **La ambigüedad se pregunta, no se adivina.** Vale para emparejar nombres al importar,
   para las filas repetidas y para cambiar la moneda de un documento.
4. **Todo lo consolidado pasa por una tasa de cambio.** Una tasa vieja no da error: da un
   número creíble y equivocado. Por eso hay actualización automática de madrugada y aviso
   al dueño cuando cambia.

---

## 1. Una venta se convierte en dinero

`CONTEXTO §2 › Contabilidad`

1. **Factura en borrador** (`/portal/ventas`). Las líneas pueden enlazarse al catálogo —el
   vínculo lo crea el clic en la sugerencia, nunca el parecido del texto—, lo que congela
   el coste y permite calcular margen.
2. **Emitir.** Toma número (`FAC-2026-####`) y, **si la factura lo marca**, descuenta
   existencias del almacén elegido (`facturas.descuenta_stock` + `almacen_id`). Es una
   decisión por factura, no una configuración global.
3. **Queda como cuenta por cobrar.** No hay un tipo «factura vencida»: CxC (`/portal/cxc`)
   se construye juntando **facturas emitidas con saldo** y **registros de tipo COBRO**
   (`src/lib/cobranza-core.ts`). Por eso el aviso de cobro vencido es uno solo y no dos.
4. **Se cobra.** El cobro escribe un **movimiento de tesorería** (`origen='COBRO'`) que
   apunta al documento por `referencia_id`. El saldo pendiente **no se guarda: se deriva**
   sumando esos movimientos.
5. **Aparece consolidado** en dashboard y reportes, convertido a la moneda de
   consolidación con la tasa vigente.

**Para analizar:** el estado de un documento nunca es un campo, es una resta. Si dos
pantallas discrepan, el sospechoso es el rango de fechas o la tasa, no el estado.

## 2. Un gasto se convierte en deuda y luego en pago

`CONTEXTO §2 › Contabilidad`

Igual que el anterior pero al revés: gasto → si queda pendiente entra en CxP con su
vencimiento (sin vencimiento no hay aging, así que el importador le pone el del propio
registro) → pago → movimiento `origen='PAGO'`.

Un gasto se identifica por **categoría** (y de ahí sale su etiqueta); un cobro lleva
**concepto libre**. Es la única diferencia entre los dos: comparten tabla
(`gastos_cobros`) y adaptador.

## 3. La caja offline entra al sistema

`CONTEXTO §2 › Caja` · `src/lib/caja/ingesta.ts`

1. El punto de venta (`/punto-de-venta`) es una **PWA que funciona sin conexión**: vende,
   cobra y cierra contra su copia local.
2. Al sincronizar sube tickets, movimientos de efectivo y turnos — **incluido el turno
   ABIERTO**. La caja **siempre guarda su propio detalle** (`caja_tickets`), tenga el
   cliente los módulos que tenga.
3. **Lo que lleva el dinero fuera de la caja es el CIERRE**, y solo si el módulo está
   contratado: un **INGRESO de tesorería por moneda y destino** (`origen='CAJA'`; efectivo
   y transferencia pueden ir a cuentas distintas) y un **cobro resumen** en `gastos_cobros`
   (`origen_tipo='CIERRE_CAJA'`, uno por moneda); con inventario, una **salida por producto**.
   Se fecha en el **día del negocio** del cierre, no en UTC.
4. Idempotencia en tres niveles: `ticket_uuid` y `movimiento_uuid` para el detalle, y los
   **movimientos reales** para los resúmenes. Re-sincronizar o volver a subir el archivo no
   duplica nada.

**Los dos caminos.** El normal es el de arriba. El de **rescate** existe porque el paso 3
depende de que alguien cierre el turno, y eso puede no pasar nunca (se fue la luz, el móvil
se perdió): en Cierres → «Sin contabilizar» el dueño ve esas ventas con su importe y las
cierra desde el portal, **con la fecha del último ticket**; y un cierre al que le faltó la
cuenta de una moneda se recupera con «Contabilizar». Los dos usan el mismo núcleo
idempotente que la ingesta, y la campana avisa de los dos casos.

**Para analizar:** ese cobro resumen **nace liquidado** —su dinero ya entró por el
movimiento del cierre—, así que el cálculo normal de saldo daría «pendiente» para siempre.
Se corrige en la lectura, no apuntando el movimiento al registro.

## 4. Una suscripción se factura sola

`CONTEXTO §2 › Servicios y Suscripciones` · `src/lib/facturacion-suscripciones.ts`

Un acuerdo tiene periodicidad y `fecha_proximo_cobro`. Cuando llega la fecha,
`facturarAutomatico` crea la **factura en borrador** (nunca emitida: emitir es una decisión
del dueño) y avanza la fecha del acuerdo. Lo dispara el **cron diario**
(`/api/cron/recordatorios`), no una acción del portal.

La idempotencia va en dos capas porque una sola no basta: (a) se avanza la fecha al
facturar y (b) cada línea guarda su `suscripcion_id`, así que un período ya facturado no
se vuelve a ofrecer aunque alguien mueva la fecha a mano. Las facturas **anuladas no
cuentan**. Sin prorrateo en esta versión.

## 5. La nómina se convierte en coste

`CONTEXTO §2 › RRHH`

Confirmar una nómina escribe **hasta ocho filas** en `gastos_cobros`, y son **dos repartos
del mismo dinero, no uno**: es el listado que más crece del sistema (un negocio con dos
empresas y nómina mensual añade ~190 filas al año solo por ahí).

**Por qué dos repartos.** No es un detalle técnico: el coste de las vacaciones se reconoce
el mes en que se **acumulan** y el pago sale el mes en que se **disfrutan**. Así que lo que
cuesta y lo que se debe son cifras distintas, y cada fila declara en su columna
`naturaleza` qué papel cumple:

| `naturaleza` | Filas | Cuenta en el estado de resultados | Genera deuda en CxP/CxC |
|---|---|---|---|
| `COSTE` | Salario devengado (sin las vacaciones disfrutadas) · Acumulación de vacaciones del mes | ✔ | — |
| `AMBAS` | UFT 5 % · SS 12,5 % · SS 1,5 % | ✔ | ✔ |
| `DEUDA` | Salario neto a pagar · una fila por retención · el subsidio por cobrar | — | ✔ |

Los tres aportes **no se desdoblan**: son coste y deuda por el mismo importe y con un
acreedor real, igual que comprarle mercancía a un proveedor. Solo el bloque salarial se
parte, y no por diseño sino porque sus dos importes son distintos. Las retenciones son
**deuda sin coste**: su coste ya está dentro del salario devengado, y llevarlas también a
Gastos duplicaría el coste de personal.

Las invariantes que valida la propia confirmación (si no cuadran, no escribe nada):

```
COSTE = (devengado − vacaciones disfrutadas) + acumulación del mes + aportes
DEUDA = neto a percibir + retenciones + aportes
COSTE − DEUDA = acumulación − vacaciones disfrutadas
```

**Dos efectos contraintuitivos que NO son fallos:** el mes que alguien coge vacaciones el
coste de personal **baja** aunque se pague más (a lo largo del año se compensa); y la
provisión de vacaciones **no genera pasivo visible** —se registra el coste, pero como
todavía no se le debe a nadie no aparece en Tesorería ni en CxP; el saldo solo se ve en la
ficha del trabajador—.

**La nómina ya no se paga desde Nómina.** No hay botón «Pagar»: cada deuda se liquida en
Tesorería con el resto, y el estado «Pagada» se **deriva** de si la CxP del salario neto
está liquidada. Depende solo del salario neto a propósito — los impuestos tienen su propio
calendario, y lo que el dueño necesita saber ahí es si su plantilla cobró.

> Esto **cierra** el punto abierto que este apartado arrastraba sobre el tratamiento
> contable de las retenciones (el coste real es el devengado, no el neto pagado).

## 6. Las tasas sostienen todos los totales

`CONTEXTO §2 › Contabilidad` · `src/lib/tasas-auto.ts` · `src/lib/tasas.ts`

Los pares de cambio (`pares_tasa`) se refrescan desde fuentes externas por tres caminos:
el botón de Monedas, el botón del dashboard y el **cron de las 5:00 hora de Cuba**
(`/api/cron/tasas`). Cuando una tasa cambia de verdad, el dueño recibe un aviso en la
campana **con la hora**, porque el dashboard amanece con otros números sin que nadie haya
tocado nada.

**Regla dura:** todo selector de moneda ofrece **las monedas del cliente**, nunca una lista
fija en código. Una moneda que el cliente no tiene no cotiza, y lo que se guarde en ella
se cae de los totales sin avisar.

## 7. Una migración entra al sistema

`CONTEXTO §2 › Importador de datos`

1. Asistente de cinco pasos sobre un motor genérico con **un adaptador por entidad**.
2. **Ninguna regla de negocio se reimplementa**: cada adaptador llama al mismo núcleo que
   el alta manual, y el stock entra por la misma función de base de datos que todo lo
   demás.
3. Lo que el archivo trae como **ya pagado** se salda contra una cuenta técnica de
   «Apertura», **fechado en el período del gasto y nunca hoy**: así el resultado cuadra por
   fecha y la caja real no se toca. Esa cuenta queda excluida de saldos, flujo de caja y
   selectores.
4. **Deshacer** existe con la semántica de cada capa: en maestros borra y se niega si algo
   ya lo usa; en el ledger compensa.

## 8. Un aviso llega al dueño

`CONTEXTO §2 › Notificaciones internas` · `src/lib/notificaciones/`

El catálogo de tipos vive **en código**, no en base de datos. Todo aviso pasa por un único
sitio donde se aplican tres filtros en este orden: **candado de módulo** (si no lo tiene
contratado, el aviso no existe) → **preferencia del tenant** → **idempotencia** (no se
avisa dos veces de lo mismo). Los que escalan por tiempo sustituyen al anterior en vez de
acumularse.

## 9. Qué puede tocar cada usuario

`CONTEXTO §2 › Modelo comercial` · `docs/MODELO-MODULOS.md`

Dos candados distintos y hay que entender que son dos:

- **Comercial:** ¿contrató el módulo? Se comprueba en **cada acción que escribe**. El
  sidebar oculta lo no contratado, pero **ocultar no es controlar**: el control está en la
  acción.
- **De rol:** un usuario de **solo lectura** ve todo y no toca nada. Única excepción
  deliberada: puede actualizar las tasas de cambio.

---

## Dónde mirar según lo que se quiera analizar

| Si el análisis va de… | Empezar por |
|---|---|
| Un importe que no cuadra entre pantallas | Rango de fechas del listado, y después la tasa aplicada (`src/lib/tasas.ts`) |
| Un estado que parece mal (pendiente/pagado) | No es un campo: es una resta de movimientos (`referencia_id`) |
| Algo que no aparece en un listado | El techo de filas del listado (`src/lib/listados.ts`) antes que los filtros |
| Una regla de negocio | El núcleo compartido `src/lib/*-core.ts`, no la pantalla |
| Qué ve o no ve un cliente | `clients.modulos_activos` + `puedeEditarModulo` |
| Algo que pasa sin que nadie lo pulse | Los crons de `vercel.json` |

## Deuda y decisiones deliberadas (no son fallos)

Un análisis externo suele señalarlas como errores. Están así a propósito:

- **El stock puede quedar negativo.** La venta ya ocurrió; bloquearla sería mentir sobre lo
  que pasó. Se hace visible, no se impide.
- **Las cuentas por cobrar y pagar no llevan filtro de fecha por defecto.** Una deuda vieja
  no puede desaparecer del listado por un filtro que el dueño no puso.
- **La factura de una suscripción nace en borrador.** Emitir es una decisión con
  consecuencias fiscales y la toma una persona.
- **Las tablas no llevan RLS activa con política abierta**: cada consulta filtra por
  `client_id` desde el servidor. Ver `CONTEXTO §2 › Esquema y datos`.

Lo que sí está pendiente de verdad está en `CONTEXTO §2 › Deuda técnica conocida` y en el
punto abierto de la nómina (proceso 5).

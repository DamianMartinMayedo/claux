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
2. Al sincronizar sube tickets y cierres. La caja **siempre guarda su propio detalle**
   (`caja_tickets`), tenga el cliente los módulos que tenga.
3. Los efectos fuera de la caja son **resúmenes por cierre**, y solo si el módulo está
   contratado: un **INGRESO de tesorería por moneda** (`origen='CAJA'`) y un **cobro
   resumen** en `gastos_cobros` (`origen_tipo='CIERRE_CAJA'`); con inventario, una
   **salida por producto**.
4. Idempotencia en dos niveles: `ticket_uuid` para el detalle y unos flags en el cierre
   para los resúmenes. Re-sincronizar o volver a subir el archivo no duplica nada.

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

Confirmar una nómina escribe **hasta cinco filas** en `gastos_cobros`: es el listado que
más crece del sistema (un negocio con dos empresas y nómina mensual añade ~120 filas al
año solo por ahí).

> **Punto abierto que un análisis debería mirar.** Las deducciones de nómina son
> **retenciones**: dinero que se le quita al trabajador para ingresarlo a la agencia
> tributaria, no un ahorro de la empresa. El coste real es el **devengado**, no el neto
> pagado. El tratamiento contable de esa diferencia está pendiente de cerrar.

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

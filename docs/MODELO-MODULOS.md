# CLAUX — Modelo comercial v2: base contable + módulos à la carte

> Spec de diseño e implementación del modelo comercial. Complementa `docs/CONTEXTO.md` §5 (que define el
> **qué** del negocio); aquí está el **cómo** técnico. Ante conflicto manda CONTEXTO.md.
>
> **Estado:** IMPLEMENTADO (junio 2026). Migraciones **017** (`modulos_catalogo` + columnas de cliente) y
> **018** (eliminación de `plans` + `ciclo_facturacion` + `payments.concepto` + ajustes) aplicadas. El gating
> del portal lee `clients.modulos_activos`; el admin tiene catálogo (`/admin/modulos`) y toggle por cliente
> con recálculo de precio; los planes cerrados se eliminaron por completo. §2 (auditoría previa) queda como
> contexto histórico de por qué se hizo el cambio. Pendiente posterior: build-out de los módulos (Inventario
> compras/movimientos, RRHH, IA) y funcionalidades por sector — ver §8.

---

## 1. El problema en una frase (resuelto)

El código modelaba **planes cerrados con nombre** (tabla `plans`: Básico/Profesional/Empresarial, con un
precio único por plan). El modelo comercial v2 (CONTEXTO §5) es otra cosa: **una base obligatoria + módulos
sueltos que el cliente activa a la carta**, y el precio mensual de cada cliente es la **suma** de su base
más los módulos que tenga encendidos. **Ya implementado**: los planes se eliminaron y el precio se calcula
desde `modulos_catalogo` según `clients.modulos_activos` + tarifa, con ciclo mensual/anual.

## 2. Contexto histórico (modelo de planes, eliminado)

El sistema arrancó con planes cerrados (tabla `plans`; gating por `plans.modulos`), **eliminados** en la migración 018. Nota histórica; no describe nada vigente.

## 2.1 Frontera base/módulo (reenfoque junio 2026) — fuente canónica

Decisión del propietario al retomar el proyecto: la **base** deja de ser un mini-ERP genérico y se
define como un **sistema contable completo aunque simple**. Esto mueve la frontera respecto a lo que
había en el código. Mapa de pertenencia de cada pieza ya construida o declarada:

| Pieza | Estado código | Destino | Acción |
|---|---|---|---|
| Ventas (facturas + ofertas) | Hecho | **BASE** | Mantener; el selector de productos pasa a depender de Inventario |
| Terceros (clientes/proveedores) | Hecho | **BASE** | Mantener |
| Monedas y tasas (multimoneda) | Hecho | **Cuenta (transversal)** | Fuera de base (071): vive en el menú de cuenta, sin gating |
| Tesorería | Placeholder | **BASE** | Construir |
| Gastos / Cobros | No existe | **BASE** | Construir |
| Cuentas por cobrar / por pagar | No existe | **BASE** | Construir |
| Reportes financieros | No existe | **BASE** | Construir |
| Productos | Hecho | **MÓDULO `inventario`** | Re-bucketing + gating |
| Almacenes | Hecho | **MÓDULO `inventario`** | Re-bucketing + gating |
| Compras | Placeholder | **MÓDULO `inventario`** | Gating; construir |
| Mis Empresas (multiempresa) | Hecho | **MÓDULO `multiempresa`** | Gating (lógica intacta) |
| RRHH | Placeholder | **MÓDULO `rrhh`** | Gating; construir |
| IA | No existe | **MÓDULO `asistente_ia`** | Construir |
| Menú QR / Reservas / Docs imprenta | No existe | **FUNCIONALIDAD** (`catalogo_qr`, `reservas_citas`, `documentos_imprenta`) | Catálogo + construir |

Claves ERP heredadas (§2) que **se retiran del MVP**: `contabilidad_simple` y `modulo_contable`
(absorbidas por la base contable completa), `rol_contador_externo` (tier contable avanzado futuro),
`presupuestos` (= ofertas, ya en base), `crm`, `activos_fijos` (futuro). `compras` deja de ser flag
propio: queda bajo `inventario`. `terceros`, `tesoreria`, `ventas` dejan de necesitar flag: son base.

## 3. Arquitectura elegida: catálogo de módulos + módulos por cliente

Decisión del propietario (frente a "reutilizar la tabla plans"): es la única que cumple CONTEXTO §5 al
100% (precio compuesto real, precio fundador/estándar por módulo, toggle por módulo con recálculo).

**La idea, simple:**
1. Un **catálogo** de módulos disponibles, con su precio (tabla `modulos_catalogo`). Es una lista de
   "productos" que CLAUX vende. Los precios viven aquí, en datos — **nunca** en el código. Cada
   entrada lleva un `tipo` (`modulo` | `funcionalidad` | `addon`) que decide cómo se agrupa y presenta
   en el admin y el portal. La contabilidad es un `modulo` más (clave `base`); el antiguo `tipo='base'`/flag
   `es_base` quedó **retirado** (068): es opcional como cualquier módulo.
2. Cada **cliente** guarda **qué módulos tiene encendidos** y a qué **tarifa** (fundador o estándar). Su
   **precio mensual** = suma de los módulos encendidos (incluida la contabilidad si la contrató), según su
   tarifa. Se recalcula cada vez que se togglea un módulo.
3. El **gating** del portal pasa a leer los módulos **del cliente** (no del plan). El resto del gating no
   cambia: `PortalSidebar` ya consume una lista de strings.

```
modulos_catalogo (catálogo de lo que se vende)         clients (cada negocio)
┌─────────────────────────────────────────┐           ┌─────────────────────────────────┐
│ clave            (PK)  catalogo_qr       │           │ client_id        (PK)           │
│ nombre                 Catálogo QR       │           │ ...                             │
│ descripcion                              │  ──────►  │ modulos_activos  [catalogo_qr,  │
│ precio_fundador_usd    10.00             │           │                   reservas_citas]│
│ precio_estandar_usd    18.00             │           │ tarifa           'fundador'     │
│ es_base          (bool) false            │           │ precio_mensual_usd  30.00       │
│ tipo  'base|modulo|funcionalidad|addon'  │           │ ciclo_facturacion 'mensual'     │
│ paginas (JSONB)  [{ruta,label,orden}]    │           │ plan_id          (NULL, inerte) │
│ orden            (int)  20               │           └─────────────────────────────────┘
│ activo           (bool) true             │
└─────────────────────────────────────────┘
```

`plan_id` se **vació** (migración 018): la tabla `plans` se eliminó y la columna queda inerte y anulable
(sin FK). El histórico de `payments` conserva los importes pero no la etiqueta de plan. El gating ya no
depende de planes.

### 3.1 Taxonomía de tipos (`modulos_catalogo.tipo`)

Cada fila del catálogo tiene un `tipo` que determina cómo se comporta en el sidebar del portal y qué
páginas internas tiene. Fuente canónica de esta clasificación.

| Tipo | Sidebar | Páginas internas | Ejemplo | ¿Se muestra si no contratado? |
|---|---|---|---|---|
| **`modulo`** | Grupo colapsable con nombre del módulo | Sí (`paginas` JSONB) | **Contabilidad** (clave `base`), Inventario, RRHH, Asistente IA | **Oculto** si no está contratado |
| **`funcionalidad`** | Items standalone (sin grupo) | No (ruta única) | Catálogo QR, Reservas y citas, Docs imprenta | **Oculto** si no está contratado |
| **`addon`** | **No genera items** en el sidebar | No | Multiempresa, Usuarios extra, Estadísticas premium | El gating se hace en la página afectada |

> **Contabilidad** es un `modulo` con clave `base` (su grupo del sidebar contiene Ventas, Gastos, CxC, CxP, Tesorería, Reportes, Terceros). El tipo `base`/flag `es_base` está **retirado** (068): ya no hay categoría especial ni "siempre activa". `Monedas y tasas` se sacó de este grupo (071): es config transversal en el menú de cuenta, sin gating.

**Detalle de cada tipo:**

- **`modulo`**: Capacidad ERP contratable (incluida la **Contabilidad**, clave `base`). Agrupa varias páginas internas bajo un grupo colapsable. Si no está contratado, el grupo **no aparece** en el sidebar (regla general: todo módulo no contratado, sea del tipo que sea, se oculta — sin candados de upsell). Las rutas se protegen con `requireModulo()`.
- **`funcionalidad`**: Feature de sector (restaurante, peluquería, etc.). Item standalone en el sidebar, fuera de grupos. Si no está contratado, **no aparece** en el menú. Las rutas están protegidas por `requireModulo()`.
- **`addon`**: Desbloquea capacidad extra en una página existente o añade una feature transversal (más empresas, más usuarios, dashboards avanzados). **No genera navegación propia**. El gating se aplica en la página afectada (ej: `empresas/page.tsx` verifica `multiempresa`). En el catálogo del admin aparece como un toggle más con su precio. Siempre se muestra en el panel de activación del cliente.

### 3.2 Sidebar dirigido por datos (`paginas` JSONB) — y sus límites

Cada fila del catálogo lleva una columna **`paginas`** (JSONB: `[{ruta, label, orden}]`, migración **024**) con
las páginas internas del módulo. El `PortalSidebar` renderiza la navegación a partir de ahí: permite **renombrar
y reordenar** entradas del menú desde el admin sin desplegar. Sirve además como **herramienta de planificación**
(declarar las páginas de un módulo antes de construirlo).

**Límite importante — qué sigue siendo código, no dato:**
- La **`ruta`** apunta a un `page.tsx` real; el **icono** se resuelve por un `ICON_MAP` en `PortalSidebar`; el
  **`page.tsx`** lo crea el desarrollador. Por tanto **crear un módulo desde el admin es media operación**: el
  precio/tipo quedan en datos, pero la página real, su ruta y su icono son código. Una `ruta` apuntando a un
  `page.tsx` inexistente da 404. Regla práctica: no editar `ruta` a mano salvo que el `page.tsx` exista.
- **Ocultar en el sidebar NO es control de acceso.** Cada ruta gateada se protege en servidor con
  `requireModulo('<clave>')` al inicio de su `page.tsx` (redirige a `/portal/dashboard` si el cliente no lo tiene).
  Lo tienen: catálogo QR, reservas, docs imprenta, IA, productos/almacenes/compras/movimientos (`inventario`),
  RRHH, **y las páginas de Contabilidad** (Ventas, Gastos, CxC, CxP, Tesorería, Reportes, Terceros →
  `requireModulo('base')`, ya que la contabilidad es opcional). `Monedas y tasas` NO está gateada (config
  transversal en el menú de cuenta). `empresas` es accesible (editas tu empresa) y el
  alta de la 2.ª empresa la limita el addon `multiempresa` dentro de la página.

> Nota de diseño: la columna `paginas` añade una capa (BD → sidebar) cuyo único beneficio real es renombrar/reordenar
> sin desplegar; ruta + icono + página viven en código igualmente. Si en el futuro estorba, revertir a un nav
> definido en código es viable (el render de grupos colapsables se conserva).

### 3.3 Receta: crear un módulo / funcionalidad / addon nuevo

Pasos repetibles (aplican a los tres `tipo`; sus diferencias, en §3.1). Sirve para construir **y** para no olvidar cómo documentarlo — que sea siempre igual es lo que evita que cada módulo se haga distinto.

1. **Datos (catálogo).** Añade una fila a `modulos_catalogo`: `clave` estable y **genérica** (nunca "menu"/"mesa", §6), `tipo`, `nombre`, precios fundador/estándar, `orden`, y `paginas` (JSONB `[{ruta,label,orden}]`) si es `modulo`/`funcionalidad`. Precios SOLO en datos, nunca en código. Migración nueva en `supabase/migrations/` con el **número siguiente** (no reutilizar).
2. **Código de la(s) página(s).** El `page.tsx`, su ruta y su icono son **código** — crear la fila del catálogo es media operación (§3.2). Crea el `page.tsx` en la ruta declarada y su icono en el `ICON_MAP` de `PortalSidebar`. Una `ruta` sin `page.tsx` da 404.
3. **Gating (obligatorio, server-side).**
   - `modulo`/`funcionalidad`: primera línea del `page.tsx` → `requireModulo('<clave>')`. Ocultar en el sidebar NO es control de acceso.
   - `addon`: no tiene ruta propia; se gatea **dentro de la página afectada** con `tieneModulo('<clave>')` (`src/lib/modulos.ts`).
4. **Independencia (regla transversal, CONTEXTO §2).** Funciona solo; la base opera sin él. Si aprovecha otro módulo, es **llenado rápido aditivo en una dirección** (cargar algo solo si el otro está activo), nunca dependencia; su modelo de datos es propio y los vínculos a otros módulos son blandos/opcionales.
5. **UI.** Toda la pantalla sigue `skills/ui/SKILL.md` (fuente única: reglas, tablas, tokens, iconos, gotchas). Etiquetas por sector, sin jerga (§6; helper `src/lib/sector.ts`). Las server actions devuelven objeto tipado y llaman `revalidatePath`.
6. **Admin.** El toggle por cliente ya existe (`ModulosCard`, agrupado por `tipo`) y recalcula `precio_mensual_usd`. No hay que tocarlo salvo que cambie la mecánica.
7. **Documentar (una sola vez, en su sitio).** Actualiza el **mapa §2 de CONTEXTO.md** con **un bullet** en el formato estándar: *qué es (clave, tipo) · estado · puntos de entrada (ruta · vista · acciones) · pendiente*. **No** párrafos-ensayo, listas de migraciones ni RPC (viven en las migraciones y el código). Gotchas de UI → `SKILL.md`. Detalles operativos volátiles (claves de proveedor, quirks) → memoria del agente. Skill nueva → regístrala en `AGENTS.md`.

## 4. Migraciones aplicadas (017 → 025)

> ✅ Aplicada como `supabase/migrations/017_modulos_catalogo.sql` (catálogo + columnas de cliente) y
> `supabase/migrations/018_eliminar_planes.sql` (elimina `plans`, añade `ciclo_facturacion`,
> `payments.concepto` y los ajustes `pago_setup_usd_default`/`descuento_anual_pct`/`dias_trial_default`;
> backfill de clientes sin módulos a `['base']`) y `019_pago_estado.sql` (`payments.estado`). El DDL completo vive en esos ficheros; no se duplica aquí — precios y claves reales en la BD (`modulos_catalogo`), nunca hardcodear.
>
> Posteriores al sistema à la carte: **`024_modulos_paginas_jsonb.sql`** (columna `paginas` para el sidebar
> dirigido por datos, §3.2) y **`025_addon_tipo.sql`** (añade el tipo `addon` al check constraint y reclasifica
> `multiempresa` como addon, §3.1). Se numeraron 024/025 (no 018/019, que ya estaban ocupadas por las anteriores)
> para no colisionar con el historial ya aplicado.

> Las claves del seed son las del **modelo vigente** (§2.1). La frontera ya está resuelta: `base` absorbe
> ventas/terceros/tesorería/gastos/cobros/CxC/CxP/reportes; `inventario` absorbe productos/almacenes/compras/
> movimientos; `multiempresa` reusa la clave existente del mismo nombre (facilita el backfill). Las claves ERP
> heredadas retiradas del MVP (`modulo_contable`, `rol_contador_externo`, `presupuestos`, `crm`, `activos_fijos`)
> **no se siembran**; cuando se diseñe el tier contable avanzado o marketing, se añaden como filas nuevas.

## 5. Cambios de código al implementar (resumen)

- **Gating** — `src/app/portal/(app)/layout.tsx`: cambiar la query que hoy lee `plans.modulos` por
  `clients.modulos_activos` (la base es un módulo opcional; no se fuerza). Sigue pasando una lista de strings al sidebar.
- **Sidebar** — `src/components/portal/PortalSidebar.tsx`: reestructurar `buildNav` a la frontera nueva.
  Grupo **Contabilidad** (base, siempre visible): Ventas, Gastos/Cobros, Cuentas por cobrar, Cuentas por
  pagar, Tesorería, Reportes, Terceros. (`Monedas y tasas` vive en el menú de cuenta, transversal.) Grupo **Inventario** (`modulo: inventario`): Productos,
  Almacenes, Compras, Movimientos. Grupos **RRHH**, **Multiempresa** (Mis Empresas), **IA**
  (`asistente_ia`). Grupo **Funcionalidades**: Catálogo QR, Reservas, Documentos imprenta. Implica mover
  Productos/Almacenes fuera del grupo "Catálogo" y Mis Empresas a su módulo, Compras de Gestión a
  Inventario, y **quitar** el item Contabilidad (`modulo_contable`).
- **Empresas (gating sin tocar lógica)** — con `multiempresa` OFF, ocultar la gestión de empresas y operar
  sobre la empresa por defecto del cliente; el scoping por `empresa_id` se mantiene intacto.
- **Editor de líneas de factura** — `src/app/portal/(app)/ventas/_DocumentoLineasEditor.tsx` ya soporta
  entrada manual y selección por `datalist`. Gatear la carga de `productos` por el módulo `inventario` en
  el fetch del formulario (`_FacturaFormModal`/`_OfertaFormModal`): sin Inventario → `productos = []`
  (manual puro); con Inventario → se cargan. No cambia la lógica de cálculo.
- **Admin** — en el detalle de cliente (`src/app/admin/(protected)/clientes/[client_id]/`): UI de **toggle
  por módulo/funcionalidad** (agrupada por `tipo`; contabilidad incluida como un módulo toggleable más) que
  actualiza `modulos_activos` y **recalcula** `precio_mensual_usd` = Σ precios de lo activo según `clients.tarifa`.
  Server action nueva en `src/app/actions/clientes.ts`.
- **Catálogo** — pantalla admin para CRUD de `modulos_catalogo` (precios fundador/estándar, `tipo`, `activo`).
- **Constante `MODULOS`** — `src/lib/planes-constants.ts` (y los 3 modales de `/admin/planes`) se unifican a
  una sola fuente leída de `modulos_catalogo`.
- **Plans** — el CRUD de `/admin/planes` se **deprecia** (no se borra de golpe; el histórico de pagos sigue
  usando `plan_id`).
- **Base contable nueva** — construir Tesorería, Gastos/Cobros, Cuentas por cobrar/pagar y Reportes
  financieros reutilizando los patrones de Ventas (trabajo de páginas, no de gating).

## 6. Nomenclatura genérica (multi-sector)

CLAUX es multi-sector por plantillas de onboarding (CONTEXTO §1). Para no "hornear" la palabra *menú* en el
código, las **claves internas** de los módulos públicos son genéricas y estables; la **etiqueta visible**
la decide la plantilla del sector:

| Clave interna (estable) | Etiqueta en restaurante | Etiqueta en otros sectores |
|---|---|---|
| `catalogo_qr` | "Menú" | "Catálogo", "Servicios", "Carta de tratamientos"… |
| `reservas_citas` (modo *aforo*) | "Reservas" (mesas) | "Reservas", "Clases" (gimnasio)… |
| `agenda` (modo *agenda*) | — | "Citas" (peluquería/clínica), "Reservas" (alquiler de cancha)… |

> **Decisión de producto (junio 2026): reservas y citas son DOS funcionalidades contratables por separado**,
> no un único módulo con dos modos. `reservas_citas` cubre el *aforo* (capacidad por franja: mesas/personas);
> el nuevo `agenda` cubre la *agenda por recurso/profesional* (1 cita por recurso y slot, con servicios de
> duración). Cada negocio contrata la que aplica; gating independiente. Esto sustituye la idea previa de un
> único `reservas_citas` con etiqueta por sector. `reservas_citas` **no se renombra** (hay datos en
> `clients.modulos_activos`); la nueva clave `agenda` evita colisión.

Regla: **el código usa la clave; la etiqueta se resuelve por sector**. Mecanismo **ya implementado**: tabla
`plantillas_sector` (etiquetas + módulos sugeridos por sector) + `clients.sector` + helper `src/lib/sector.ts`
(`etiquetasDe`) y la server action `obtenerEtiquetasNegocio()`. Nunca poner "menu"/"mesa" en una clave, ruta
de BD o flag. Las 14 claves ERP actuales no se renombran (es arriesgado y no aportan al cambio).

## 7. La IA es UN addon transversal, no features sueltos

`asistente_ia` es **una sola fila** del catálogo con **precio fijo** (+$15/+$25). No se trocea por caso de
uso. **Es un `addon`** (reclasificado de módulo en la mig. 071): no genera navegación propia en el sidebar;
aparece como **puntos de entrada (icono + tooltip)** repartidos por la plataforma y un **chat flotante** del
dueño. Cómo funciona (implementado v1 — detalle en CONTEXTO §2 «Asistente IA construido»):

- Se le **pasa un contexto ACOTADO del negocio** (resumen ya agregado del tenant vía `obtenerDashboard()`,
  scoped por `client_id` y por módulos contratados): aislamiento entre tenants y coste bajo (no se vuelca la BD).
- **Actúa distinto según desde dónde se le llame**: analizar números (Dashboard), chat libre del dueño,
  reservar/pedir cita en lenguaje natural (Telegram). El comportamiento lo decide el punto de invocación.
- Coherente con los principios de CONTEXTO: §6 motor híbrido (la IA solo interpreta lenguaje libre; la
  ACCIÓN la ejecuta el código determinista con las RPC existentes), §7 límites/medición por tenant
  (`ia_uso`), §4 proveedor como adaptador intercambiable (**OpenCode Zen**, `ia_model`/`ia_api_base` en
  `settings`; salida siempre desde el servidor).
- **Gating por touchpoint** con `tieneModulo('asistente_ia')` (un addon no se protege con `requireModulo`
  porque no tiene ruta propia); el nombre del agente y el uso del mes se editan/ven en `/portal/perfil`.

## 8. Estado de implementación

**Hecho (migraciones 017–025):**
- [x] **017** aplicada: `modulos_catalogo` (`tipo`) + columnas `clients.modulos_activos`/`tarifa`/`precio_mensual_usd`; seed de 8 filas.
- [x] **Gating** del portal lee `clients.modulos_activos` (`layout.tsx`).
- [x] **Sidebar** reestructurado a la frontera nueva (Contabilidad/base, Inventario, RRHH, Multiempresa, IA, Funcionalidades); item Contabilidad (`modulo_contable`) retirado.
- [x] **Gating de Empresas** por módulo `multiempresa` (OFF → máx. 1 empresa); `empresa_id` intacto.
- [x] **Admin toggle** en detalle de cliente (`ModulosCard`, agrupado por `tipo`; contabilidad toggleable como un módulo más) + `setModulosCliente` (recalcula `precio_mensual_usd`).
- [x] **Admin catálogo** `/admin/modulos` (CRUD de precios/`activo`).
- [x] **Backfill** de clientes sin módulos → `['base']` (en 018).
- [x] **Planes eliminados (018)**: tabla `plans` borrada, `plan_id` vaciado, `/admin/planes` + `planes-constants.ts` + `cambiarPlan` retirados.
- [x] **Ciclo de facturación** `clients.ciclo_facturacion` (mensual/anual con descuento configurable); importe del cobro derivado en `obtenerDatosPagoDefecto`.
- [x] **Pago de configuración** `payments.concepto` (`suscripcion`|`configuracion`); registrado opcionalmente al crear cliente; ajustes en `/admin/configuracion`.
- [x] **Tipo `addon`** (025): cuarto tipo del catálogo; `multiempresa` reclasificado como addon (sin item de sidebar, gating en la página). Toggle en `ModulosCard` con grupo «Addons».
- [x] **Sidebar dirigido por datos** (024): columna `paginas` (JSONB); el sidebar renderiza grupos colapsables desde el catálogo. Caveats y guards en §3.2.
- [x] **Guards de ruta** `requireModulo()` en todas las rutas gateadas: catálogo QR, reservas, docs imprenta, IA, `inventario` (productos/almacenes/compras/movimientos) y RRHH. (Ocultar en el sidebar no protege; el guard sí.)
- [x] **Base contable completa (Fase 4)**: Tesorería, Gastos/Cobros, CxC/CxP y Reportes financieros construidos; selector de productos del editor de líneas gateado por `inventario`.
- [x] **Asistente IA v1 (mig. 071)**: `asistente_ia` reclasificado de módulo a **addon**; núcleo `src/lib/ia/` (provider OpenCode Zen + contexto acotado + agente + medición + intérprete de bot), touchpoints en Dashboard, chat flotante del dueño, sección de Perfil (nombre + uso) y admin de modelo/consumo. Capa de Telegram en lenguaje natural sobre el motor híbrido. Detalle en CONTEXTO §2.
- [x] **Catálogo QR (mig. 077, julio 2026)**: funcionalidad `catalogo_qr` construida — modelo propio (`catalogo_categorias`/`catalogo_items`) independiente de Inventario, editor `/portal/catalogo`, público `/[slug]/catalogo` (ISR), imágenes optimizadas cliente+servidor, QR, PWA/offline, IA de cara al dueño (autocompletar + insight). Detalle en CONTEXTO §2.

**Pendiente:**
- [ ] **Build-out de módulos**: funcionalidad por sector `documentos_imprenta`. Chat embebido de IA en la mini-web pública para clientes finales (requiere medición/rate-limit propios de tráfico anónimo).

## 9. Discrepancias detectadas (registro, con recomendación)

| # | Discrepancia | Recomendación |
|---|---|---|
| D1 | `actualizarPlan` guardaba `plans.modulos` como CSV y rompía el gating al editar | **Resuelto** (CONTEXTO §2, ahora array). Queda moot al pasar el gating a `clients.modulos_activos`. |
| D2 | `plans.precio_usd` / `nivel` / `modalidad` (precio único por tier) | Superado por el precio compuesto (`clients.precio_mensual_usd`). |
| D3 | `docs/CLAUX-LEGACY.md` usaba nombres Básico/Profesional/Empresarial | **Resuelto: LEGACY eliminado** (contenido vivo absorbido en CONTEXTO/SKILL). Ya no hay tercera fuente que contradiga. |
| D4 | `plans.max_empresas` / `max_usuarios` (límites en el plan) | **Resuelto**: el límite de empresas lo da el módulo `multiempresa` (OFF → 1 empresa); ver `empresas.ts` y `empresas/page.tsx`. `max_usuarios` queda como futuro. |
| D5 | `BloqueadoScreen` solo cubre SUSPENDIDO/VENCIDO; la degradación gradual (aviso→degradación→corte, CONTEXTO §8) está parcial | Anotado para la fase de corte por impago. |

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

## 2. Lo que había antes (auditoría histórica, pre-migración 018)

> Contexto de por qué se hizo el cambio. La tabla `plans` y la UI de planes descritas aquí **ya no existen**.

- **Tabla `plans`** (creada a mano en Supabase, no está en `supabase/migrations/`). Columnas: `plan_id`
  (PK, p.ej. `BM001`), `nombre`, `nivel` (basico/profesional/empresarial), `modalidad`, `precio_usd`,
  `duracion_dias`, `dias_trial`, `max_empresas`, `max_usuarios`, `modulos`, `estado`, `visible`,
  `descripcion`.
- **`clients.plan_id`** es FK a `plans`. Cada cliente apunta a UN plan.
- **El gating del portal NO depende del nombre del plan.** Depende 100% de la lista `plans.modulos`. Punto
  único de lectura: `src/app/portal/(app)/layout.tsx` (líneas 26-36) lee `plans.modulos` → pasa
  `modulosActivos: string[]` a `src/components/portal/PortalSidebar.tsx`, que en la línea 89 hace
  `modulosActivos.includes(item.modulo)` para candar cada item. **Esto es una suerte**: cambiar de dónde
  salen los módulos apenas toca una query.
- **14 claves de módulo ERP** definidas hoy (y **duplicadas** en `NuevoPlanModal.tsx`,
  `EditarPlanModal.tsx`, `DuplicarPlanBtn.tsx`): `ventas, compras, tesoreria, terceros,
  contabilidad_simple, modulo_contable, inventario, rrhh, gestion_documental, rol_contador_externo,
  multiempresa, presupuestos, crm, activos_fijos`.
- **No hay planes sembrados**: se crean a mano desde `/admin/planes`.
- **No existe** ningún módulo ni UI público de "menú/catálogo/reservas/citas": son trabajo futuro.

## 2.1 Frontera base/módulo (reenfoque junio 2026) — fuente canónica

Decisión del propietario al retomar el proyecto: la **base** deja de ser un mini-ERP genérico y se
define como un **sistema contable completo aunque simple**. Esto mueve la frontera respecto a lo que
había en el código. Mapa de pertenencia de cada pieza ya construida o declarada:

| Pieza | Estado código | Destino | Acción |
|---|---|---|---|
| Ventas (facturas + ofertas) | Hecho | **BASE** | Mantener; el selector de productos pasa a depender de Inventario |
| Terceros (clientes/proveedores) | Hecho | **BASE** | Mantener |
| Monedas y tasas (multimoneda) | Hecho | **BASE** | Mantener |
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
   entrada lleva un `tipo` (`base` | `modulo` | `funcionalidad`) que decide cómo se agrupa y presenta
   en el admin y el portal; `es_base` marca la fila obligatoria que siempre está activa.
2. Cada **cliente** guarda **qué módulos tiene encendidos** y a qué **tarifa** (fundador o estándar). Su
   **precio mensual** = base + suma de los módulos encendidos, según su tarifa. Se recalcula cada vez que
   se togglea un módulo.
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
│ tipo             'funcionalidad'         │           │ ciclo_facturacion 'mensual'     │
│ orden            (int)  20               │           │ plan_id          (NULL, inerte) │
│ activo           (bool) true             │           └─────────────────────────────────┘
└─────────────────────────────────────────┘
```

`plan_id` se **vació** (migración 018): la tabla `plans` se eliminó y la columna queda inerte y anulable
(sin FK). El histórico de `payments` conserva los importes pero no la etiqueta de plan. El gating ya no
depende de planes.

## 4. Migración SQL — APLICADA (017 + 018)

> ✅ Aplicada como `supabase/migrations/017_modulos_catalogo.sql` (catálogo + columnas de cliente) y
> `supabase/migrations/018_eliminar_planes.sql` (elimina `plans`, añade `ciclo_facturacion`,
> `payments.concepto` y los ajustes `pago_setup_usd_default`/`descuento_anual_pct`/`dias_trial_default`;
> backfill de clientes sin módulos a `['base']`). El DDL de 017 se conserva abajo como referencia.

```sql
-- ── 017: Catálogo de módulos + módulos por cliente (modelo à la carte) ──────────

-- 1. Catálogo de módulos vendibles
CREATE TABLE IF NOT EXISTS modulos_catalogo (
  clave                text PRIMARY KEY,           -- p.ej. 'catalogo_qr'
  nombre               text NOT NULL,
  descripcion          text,
  precio_fundador_usd  numeric(10,2) NOT NULL DEFAULT 0,
  precio_estandar_usd  numeric(10,2) NOT NULL DEFAULT 0,
  es_base              boolean NOT NULL DEFAULT false,  -- la base obligatoria (siempre activa)
  tipo                 text    NOT NULL DEFAULT 'modulo',  -- 'base' | 'modulo' | 'funcionalidad'
  orden                int NOT NULL DEFAULT 0,
  activo               boolean NOT NULL DEFAULT true
);

-- 2. Módulos activos y precio compuesto por cliente
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS modulos_activos    text[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tarifa             text          NOT NULL DEFAULT 'estandar',  -- 'fundador'|'estandar'
  ADD COLUMN IF NOT EXISTS precio_mensual_usd numeric(10,2) NOT NULL DEFAULT 0;

-- 3. Seed del catálogo (precios fundador / estándar de CONTEXTO §5 — AJUSTAR si cambian)
INSERT INTO modulos_catalogo (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden) VALUES
  ('base',            'Base contable',     'Ventas, gastos/cobros, cuentas por cobrar/pagar, tesorería, reportes, terceros, multimoneda', 20, 35, true,  'base',          10),
  ('inventario',      'Inventario',        'Almacenes, productos, compras, movimientos, disponibilidad',                                  8,  14, false, 'modulo',        20),
  ('rrhh',            'RRHH',              'Personal, contratos, bajas, turnos, nómina simple',                                           8,  14, false, 'modulo',        30),
  ('multiempresa',    'Multiempresa',      'Varias empresas/locales con consolidación',                                                   12, 20, false, 'modulo',        40),
  ('asistente_ia',    'Asistente IA',      'Chat con clientes, NL para reservas/pedidos, consultas del dueño, resumen semanal',           15, 25, false, 'modulo',        50),
  ('catalogo_qr',     'Catálogo digital QR + mini-web', 'Carta/catálogo por QR, mini-web pública, multi-idioma opcional',                 10, 18, false, 'funcionalidad', 60),
  ('reservas_citas',  'Reservas y citas + bot', 'Formulario, panel, bot de botones, notificaciones',                                      10, 18, false, 'funcionalidad', 70),
  ('documentos_imprenta', 'Documentos de imprenta', 'El cliente envía sus documentos por correo antes de recogerlos',                     0,  0,  false, 'funcionalidad', 80)
ON CONFLICT (clave) DO NOTHING;

-- 4. Grants a service_role (toda la app accede vía service_role; patrón de 011_grants_rls.sql)
ALTER TABLE modulos_catalogo ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.modulos_catalogo TO service_role;

-- 5. Recargar caché de PostgREST
notify pgrst, 'reload schema';
```

> Las claves del seed son las del **modelo vigente** (§2.1). La frontera ya está resuelta: `base` absorbe
> ventas/terceros/tesorería/gastos/cobros/CxC/CxP/reportes; `inventario` absorbe productos/almacenes/compras/
> movimientos; `multiempresa` reusa la clave existente del mismo nombre (facilita el backfill). Las claves ERP
> heredadas retiradas del MVP (`modulo_contable`, `rol_contador_externo`, `presupuestos`, `crm`, `activos_fijos`)
> **no se siembran**; cuando se diseñe el tier contable avanzado o marketing, se añaden como filas nuevas.

## 5. Cambios de código al implementar (resumen)

- **Gating** — `src/app/portal/(app)/layout.tsx`: cambiar la query que hoy lee `plans.modulos` por
  `clients.modulos_activos` (incluir siempre `'base'`). Sigue pasando una lista de strings al sidebar.
- **Sidebar** — `src/components/portal/PortalSidebar.tsx`: reestructurar `buildNav` a la frontera nueva.
  Grupo **Contabilidad** (base, siempre visible): Ventas, Gastos/Cobros, Cuentas por cobrar, Cuentas por
  pagar, Tesorería, Reportes, Terceros, Monedas. Grupo **Inventario** (`modulo: inventario`): Productos,
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
  por módulo/funcionalidad** (agrupada por `tipo`; base bloqueada en ON) que actualiza `modulos_activos` y
  **recalcula** `precio_mensual_usd` = precio de `base` + Σ precios de lo activo según `clients.tarifa`.
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
| `reservas_citas` | "Reservas" (mesas) | "Citas" (peluquería), "Clases" (gimnasio)… |

Regla: **el código usa la clave; la etiqueta se resuelve por sector** (tabla/constante de plantillas, a
crear en implementación). Nunca poner "menu" en una clave, ruta de BD o flag. Las 14 claves ERP actuales no
se renombran (es arriesgado y no aportan al cambio).

## 7. La IA es UN módulo, no features sueltos

`asistente_ia` es **una sola fila** del catálogo con **precio fijo** (+$15/+$25). No se trocea en módulos
por caso de uso. Cómo funciona:

- Se le **pasa el contexto del negocio** (datos del tenant: catálogo, horarios, reservas, números…).
- **Actúa distinto según desde dónde se le llame**: reservar, analizar números, hablar del catálogo, hacer
  el resumen semanal. El destino y el comportamiento los decide el punto de invocación, no módulos
  separados.
- Coherente con los principios de CONTEXTO: §6 motor híbrido (la IA solo entra en conversación libre; lo
  predecible lo resuelve código), §7 límites/medición por tenant, §4 proveedor DeepSeek como adaptador
  intercambiable, salida siempre desde el servidor.
- Su disponibilidad se gatea como cualquier módulo: `asistente_ia` dentro de `clients.modulos_activos`.

## 8. Estado de implementación

**Hecho (migraciones 017 + 018):**
- [x] **017** aplicada: `modulos_catalogo` (`tipo`) + columnas `clients.modulos_activos`/`tarifa`/`precio_mensual_usd`; seed de 8 filas.
- [x] **Gating** del portal lee `clients.modulos_activos` (`layout.tsx`).
- [x] **Sidebar** reestructurado a la frontera nueva (Contabilidad/base, Inventario, RRHH, Multiempresa, IA, Funcionalidades); item Contabilidad (`modulo_contable`) retirado.
- [x] **Gating de Empresas** por módulo `multiempresa` (OFF → máx. 1 empresa); `empresa_id` intacto.
- [x] **Admin toggle** en detalle de cliente (`ModulosCard`, agrupado por `tipo`, base bloqueada) + `setModulosCliente` (recalcula `precio_mensual_usd`).
- [x] **Admin catálogo** `/admin/modulos` (CRUD de precios/`activo`).
- [x] **Backfill** de clientes sin módulos → `['base']` (en 018).
- [x] **Planes eliminados (018)**: tabla `plans` borrada, `plan_id` vaciado, `/admin/planes` + `planes-constants.ts` + `cambiarPlan` retirados.
- [x] **Ciclo de facturación** `clients.ciclo_facturacion` (mensual/anual con descuento configurable); importe del cobro derivado en `obtenerDatosPagoDefecto`.
- [x] **Pago de configuración** `payments.concepto` (`suscripcion`|`configuracion`); registrado opcionalmente al crear cliente; ajustes en `/admin/configuracion`.

**Pendiente:**
- [ ] **Completar la base contable**: Tesorería, Gastos/Cobros, Cuentas por cobrar/pagar y Reportes financieros (reutilizando patrones de Ventas).
- [ ] **Gatear el selector de productos** del editor de líneas (`_DocumentoLineasEditor`) por el módulo `inventario` (sin módulo → entrada manual).
- [ ] **Build-out de módulos**: Inventario (compras/movimientos), RRHH, Asistente IA; funcionalidades por sector (catálogo QR, reservas, documentos imprenta).

## 9. Discrepancias detectadas (registro, con recomendación)

| # | Discrepancia | Recomendación |
|---|---|---|
| D1 | `actualizarPlan` guardaba `plans.modulos` como CSV y rompía el gating al editar | **Resuelto** (CONTEXTO §2, ahora array). Queda moot al pasar el gating a `clients.modulos_activos`. |
| D2 | `plans.precio_usd` / `nivel` / `modalidad` (precio único por tier) | Superado por el precio compuesto (`clients.precio_mensual_usd`). |
| D3 | `docs/CLAUX-LEGACY.md` usa nombres Básico/Profesional/Empresarial | Marcado superado en CONTEXTO §2; al editar LEGACY, alinear a base + módulos. |
| D4 | `plans.max_empresas` / `max_usuarios` (límites en el plan) | **Resuelto**: el límite de empresas lo da el módulo `multiempresa` (OFF → 1 empresa); ver `empresas.ts` y `empresas/page.tsx`. `max_usuarios` queda como futuro. |
| D5 | `BloqueadoScreen` solo cubre SUSPENDIDO/VENCIDO; la degradación gradual (aviso→degradación→corte, CONTEXTO §8) está parcial | Anotado para la fase de corte por impago. |

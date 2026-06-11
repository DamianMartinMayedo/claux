> **Aviso:** Especificación original del enfoque mini-ERP genérico. Sigue siendo válida como referencia técnica (design system, esquema de BD, flujos financieros), pero el modelo de producto vigente es el de [docs/CONTEXTO.md](CONTEXTO.md).

---

# CLAUX — Guía Técnica y de Diseño
**Versión:** 2.0 (Next.js + Supabase) | **Basada en:** Documento Base v1.0 (GAS) + Design System v1.0

---

## 1. Descripción del Producto

CLAUX es un SaaS de mini ERP modular orientado a PYMES cubanas. Permite gestionar múltiples empresas, consolidar cuentas y operar con usuario y contraseña propios sin dependencia de cuentas externas. El propietario del sistema (Super Admin) gestiona clientes, planes y suscripciones desde un panel de administración central.

**Tagline:** Tu negocio, bajo control.

---

## 2. Stack Tecnológico (Migración Next.js)

El proyecto original fue construido en Google Apps Script + Google Sheets. Esta versión migra a un stack moderno manteniendo toda la lógica de negocio.

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15/16 con App Router y TypeScript |
| Base de datos | Supabase (PostgreSQL) |
| Autenticación super admin | Supabase Auth (email + password) |
| Autenticación usuarios cliente | Tabla propia `client_users` + SHA-256 + salt (Web Crypto API) |
| Despliegue frontend | Vercel (conectado a GitHub) |
| Estilos | CSS custom properties — sin clases de Tailwind, solo `@import "tailwindcss"` como reset |
| Fuentes | Cabinet Grotesk + Satoshi via Fontshare CDN |
| Acciones de servidor | Next.js Server Actions (`'use server'`) |
| Middleware | `src/proxy.ts` con función `proxy()` (Next.js 16 renombra middleware.ts) |

### Clientes Supabase

Existen dos instancias separadas del cliente:

- `src/lib/supabase/server.ts` — Lee cookies de la request. Se usa en Server Components y Server Actions.
- `src/lib/supabase/client.ts` — Para el navegador. Se usa en Client Components cuando se necesita interactividad con la base de datos directamente.

### Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 3. Arquitectura del Proyecto

### Estructura de carpetas relevante

```
src/
├── app/
│   ├── globals.css                      ← Design System completo (tokens + clases)
│   ├── layout.tsx                       ← Root layout (fuentes, metadata)
│   ├── page.tsx                         ← Redirige a /admin/login
│   ├── actions/                         ← Server Actions
│   │   ├── clientes.ts
│   │   └── planes.ts
│   └── admin/
│       ├── login/page.tsx               ← Login super admin (fuera del layout protegido)
│       └── (protected)/                 ← Route group — aplica layout con auth guard
│           ├── layout.tsx               ← Verifica sesión, renderiza Header + Sidebar
│           ├── dashboard/page.tsx
│           ├── clientes/
│           │   ├── page.tsx
│           │   └── NuevoClienteModal.tsx
│           └── planes/
│               ├── page.tsx
│               └── EditarPlanModal.tsx
├── components/
│   └── admin/
│       ├── Header.tsx                   ← Client Component — header superior fijo
│       └── Sidebar.tsx                  ← Client Component — navegación lateral
└── lib/
    └── supabase/
        ├── client.ts
        └── server.ts
```

### Route group `(protected)`

El paréntesis en el nombre del directorio es una convención de Next.js App Router. No afecta la URL pero permite aplicar un layout compartido (auth guard + Header + Sidebar) solo a las páginas protegidas, manteniendo la página de login fuera de ese layout y evitando bucles de redirección.

### Middleware (`src/proxy.ts`)

En Next.js 16 el archivo se llama `proxy.ts` y la función exportada se llama `proxy()` (ya no `middleware`). Protege todas las rutas `/admin/*` y redirige según el estado de sesión de Supabase Auth.

### Server Components vs Client Components

- **Server Components** (sin directiva): páginas que solo muestran datos. Se conectan directamente a Supabase. No envían JavaScript al navegador. Ejemplos: `dashboard/page.tsx`, `clientes/page.tsx`, `planes/page.tsx`.
- **Client Components** (`'use client'`): necesitan estado, eventos o interactividad. Ejemplos: `Header.tsx`, `Sidebar.tsx`, `NuevoClienteModal.tsx`, `EditarPlanModal.tsx`.

---

## 4. Base de Datos — Esquema Principal

RLS deshabilitado en todas las tablas durante el desarrollo. La separación multi-tenant se gestiona por `client_id` en cada tabla.

### Tablas del panel de administración

| Tabla | Propósito |
|---|---|
| `plans` | Planes de suscripción disponibles |
| `clients` | Clientes registrados en el sistema |
| `payments` | Pagos de suscripción |

### Tablas del ERP por cliente

Cada tabla incluye `client_id` para el aislamiento multi-tenant.

| Tabla | Propósito |
|---|---|
| `client_users` | Usuarios del ERP de cada cliente (no usan Supabase Auth) |
| `client_sessions` | Tokens de sesión de usuarios cliente |
| `companies` | Empresas del cliente |
| `currencies` | Monedas configuradas por empresa |
| `third_parties` | Clientes y proveedores unificados |
| `product_categories` | Categorías del catálogo |
| `products` | Catálogo de productos y servicios |
| `sales` | Cabecera de facturas emitidas |
| `sale_lines` | Líneas de facturas emitidas |
| `sale_logs` | Auditoría de operaciones |

### Campos obligatorios en todas las tablas operativas

Para garantizar integridad en reportes y auditoría, toda tabla transaccional debe incluir:

```
fecha_documento   — fecha del hecho económico (no de registro)
fecha_registro    — timestamp de creación en el sistema
client_id         — aislamiento multi-tenant
empresa_id        — para reportes multi-empresa
moneda            — moneda de la operación
tipo_cambio       — tasa respecto a la moneda funcional
categoria         — categoría simple o código contable
periodo_id        — período contable abierto al momento del registro
creado_por        — user_id del usuario que creó el registro
estado            — BORRADOR | CONFIRMADO | ANULADO
```

**Regla de oro:** los registros nunca se eliminan físicamente. Todo se anula con `estado = ANULADO`. El borrado físico solo aplica a borradores no confirmados.

---

## 5. Autenticación

### Super Admin (panel de administración)

Usa Supabase Auth con email y contraseña. La cuenta se crea desde el panel de Supabase > Authentication > Users. Solo existe un super admin.

El layout protegido verifica la sesión en cada request:

```typescript
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/admin/login')
```

### Usuarios de clientes (ERP)

No usan Supabase Auth. Se almacenan en la tabla `client_users` con:

- Contraseña hasheada con SHA-256 + salt único por usuario (Web Crypto API nativa de Node.js)
- Token de sesión UUID con timestamp de expiración (2–4 horas) en tabla `client_sessions`
- El frontend guarda el token en localStorage y lo envía en cada petición
- El servidor valida existencia, expiración y correspondencia con el usuario en cada request

```typescript
async function hashPassword(password: string, salt: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
```

### Roles del sistema

**En el panel de administración:**
- `super_admin` — control total, solo el dueño del SaaS

**En el ERP de cada cliente:**
- `admin_empresa` — configuración, usuarios, empresas, suscripción
- `usuario` — operación según módulos asignados
- `solo_lectura` — visualización sin modificaciones
- `contador_externo` — acceso filtrado: solo módulos contables y fiscales, sin RRHH, caja detallada ni notas internas

---

## 6. Lógica de Negocio — Módulos y Planes

### Planes de suscripción

| Funcionalidad | Básico | Profesional | Empresarial |
|---|---|---|---|
| Empresas | 1 | 2 + consolidación | 5+ + consolidación |
| Usuarios | 2 | 5 | Ilimitados |
| Ventas / Facturación | Sí | Sí | Sí |
| Compras / Proveedores | Sí | Sí | Sí |
| Tesorería / Caja y Banco | Sí | Sí | Sí |
| Clientes y Proveedores | Sí | Sí | Sí |
| Contabilidad Modo Simple | Sí | Sí | Sí |
| Módulo Contable (plan editable) | No | Sí | Sí |
| Inventario | No | Sí | Sí |
| RR.HH. Básico (nómina) | No | Sí | Sí |
| Gestión Documental | No | Sí | Sí |
| Presupuestos y Control | No | No | Sí |
| CRM Básico | No | No | Sí |
| Activos Fijos | No | No | Sí |
| Rol Contador Externo | No | Sí | Sí |
| Soporte | 72h email | 24h email | 4h email + Chat |

Los módulos bloqueados deben ser visibles en la UI pero inactivos, con un call-to-action de upgrade — nunca ocultos.

### Flujos financieros core

**Principio fundamental:** el gasto nace cuando se recibe la obligación. El pago nace cuando sale el dinero. Son eventos distintos del mismo hecho económico. La CxP es el puente.

**Flujo A — Gasto en dos pasos:**
`COMPRAS genera factura → CxP creada → Tesorería registra pago vinculando CxP → CxP marcada PAGADA`

**Flujo B — Gasto directo (sin factura previa):**
`Tesorería registra egreso directo → Selecciona categoría → Sin CxP, evento único`

**Flujo C — Cobro de venta:**
`VENTAS genera factura → CxC creada → Tesorería registra cobro vinculando CxC → CxC marcada COBRADA`

Reglas de negocio estrictas:
- Una CxP con estado `PAGADA` no puede usarse en otro pago
- `origen_id` es único por movimiento de tesorería — imposible doble registro
- Los reportes de gastos leen solo de `COMPRAS`, nunca de `TESORERIA`

### Contabilidad modo dual

- **Modo Simple:** categorías en lenguaje natural (Venta, Gasto Operacional, Alquiler...). Disponible en todos los planes.
- **Modo Contable:** plan de cuentas con códigos estándar. Se activa en Profesional y Empresarial. El sistema traduce registros simples a asientos contables automáticamente.

### Multi-moneda

Operativo desde V1. Monedas base: CUP, MLC, USD, EUR. Acepta cualquier código ISO 4217.

- Cada empresa tiene una moneda funcional (base para reportes)
- Cada operación se puede registrar en cualquier moneda
- El tipo de cambio se define manualmente por operación (sin API externa de tasas en V1)
- Los reportes convierten todo a la moneda funcional usando la tasa registrada en cada documento

### Numeración correlativa de documentos

Formato: `FAC-2026-0001` — configurable por tipo de documento (FAC, OC, NC, REC). Los números anulados dejan un hueco; el documento queda en estado `ANULADO` con su número original y nunca se reasigna. Cada empresa tiene su propia secuencia independiente.

---

## 7. UX — Reglas de Interfaz Obligatorias

Diseñadas para el contexto de conectividad variable de los usuarios finales:

- **Indicador de carga siempre visible:** spinner desde el primer clic hasta recibir respuesta.
- **Prevenir doble submit:** el botón de acción se deshabilita inmediatamente tras el primer clic. Se reactiva solo si la operación falla.
- **Timeout con mensaje amigable:** si no hay respuesta en 15 segundos mostrar aviso claro con opción de cancelar. Nunca pantalla congelada sin retroalimentación.
- **Confirmación antes de acciones críticas:** registrar un pago, anular una factura, cerrar un período — siempre mostrar resumen y requerir confirmación explícita.
- **Feedback de éxito claro:** tras guardar, mostrar mensaje visible con el número de documento generado o la acción completada.
- **Sin emojis en ninguna parte de la UI.** Usar exclusivamente iconos SVG profesionales.

---

## 8. CLAUX Design System v1.0

### Identidad visual

- **Art direction:** Mini ERP para PYMES — cálido, claro, confiable.
- **Paleta:** Teal cálido (confianza + crecimiento) + Ámbar (calor caribeño).
- **Tipografía:** Cabinet Grotesk (display) + Satoshi (body).
- **Densidad:** Balanced — no demasiado denso, no demasiado espacioso.

---

### Tokens de color — Light theme (valores exactos del Design System)

#### Superficies (crema cálida)
```css
--color-bg:                #F5F4EF   /* Fondo de página */
--color-surface:           #F8F7F2   /* Cards, paneles, sidebar, header */
--color-surface-2:         #FAFAF6   /* Contenido elevado dentro de cards */
--color-surface-offset:    #EEEDЕ8   /* Hover, seleccionado */
--color-surface-offset-2:  #E7E6E0
--color-surface-dynamic:   #DDDBD4
--color-divider:           #D5D3CC   /* Separadores internos */
--color-border:            #CCCAC2   /* Bordes de inputs, cards, tablas */
```

#### Texto (carbón cálido)
```css
--color-text:         #1C1B16   /* Texto principal */
--color-text-muted:   #6A6960   /* Texto secundario, labels, muted */
--color-text-faint:   #AEADA6   /* Placeholders, metadatos */
--color-text-inverse: #F8F7F2   /* Texto sobre fondos oscuros */
```

#### Primario — Teal CLAUX
```css
--color-primary:           #00AFAA   /* Acción principal, links activos */
--color-primary-hover:     #00928E   /* Hover */
--color-primary-active:    #007571   /* Active / pressed */
--color-primary-highlight: #C8ECEA   /* Fondo suave con tinte teal */
--color-primary-subtle:    #E9F9F8   /* Chips, tags, fondos activos nav */
```

#### Secundario — Ámbar Caribe
```css
--color-amber:           #C97A0C
--color-amber-hover:     #A86208
--color-amber-active:    #864D06
--color-amber-highlight: #F2E2C4
```

#### Estados funcionales
```css
--color-success:           #2E7D32
--color-success-highlight: #C8E6C9
--color-warning:           #C97A0C
--color-warning-highlight: #F2E2C4
--color-error:             #B71C1C
--color-error-highlight:   #FFCDD2
--color-info:              #00AFAA
--color-info-highlight:    #C8ECEA
```

#### Dark theme (se aplica automáticamente con `@media (prefers-color-scheme: dark)` o con `[data-theme="dark"]`)
```css
--color-bg:       #131210
--color-surface:  #181714
--color-border:   #353330
--color-text:     #CCCAC5
--color-primary:  #3FD4CF
```

---

### Tipografía

#### Fuentes
```
Cabinet Grotesk — display, títulos, logotipo
Satoshi         — body, formularios, tablas, navegación
```

Carga desde Fontshare (en `src/app/layout.tsx`):
```html
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,600,700,800&f[]=satoshi@300,400,500,700&display=swap" rel="stylesheet">
```

#### Regla de territorios

| Fuente | Cuándo usarla |
|---|---|
| Cabinet Grotesk | Solo en `--text-xl` y superior — títulos de página, nombres de módulo, logotipo, valores métricos grandes |
| Satoshi | Desde `--text-lg` hacia abajo — todo el texto operacional: labels, cuerpo, botones, tablas, formularios |

#### Escala tipográfica (fluida con clamp)
```css
--text-xs:   clamp(0.75rem,  0.7rem  + 0.25vw, 0.875rem)
--text-sm:   clamp(0.875rem, 0.8rem  + 0.35vw, 1rem)
--text-base: clamp(1rem,     0.95rem + 0.25vw, 1.125rem)
--text-lg:   clamp(1.125rem, 1rem    + 0.75vw, 1.5rem)
--text-xl:   clamp(1.5rem,   1.2rem  + 1.25vw, 2.25rem)
--text-2xl:  clamp(2rem,     1.2rem  + 2.5vw,  3.5rem)
--text-3xl:  clamp(2.5rem,   1rem    + 4vw,    5rem)
```

#### Pesos tipográficos en uso

| Peso | Uso |
|---|---|
| 400 | Cuerpo de texto, descripciones |
| 500 | Botones, etiquetas de formulario, navegación |
| 600 | Semibold — encabezados de sección intermedios |
| 700 | Títulos de página, títulos de cards |
| 800 | ExtraBold — logotipo, valores de métricas, héroe |

---

### Espaciado (base 4px)

```css
--space-1:  0.25rem    --space-2:  0.5rem    --space-3:  0.75rem
--space-4:  1rem       --space-5:  1.25rem   --space-6:  1.5rem
--space-8:  2rem       --space-10: 2.5rem    --space-12: 3rem
--space-16: 4rem       --space-20: 5rem      --space-24: 6rem
```

---

### Radios de borde

```css
--radius-sm:   0.375rem
--radius-md:   0.5rem
--radius-lg:   0.75rem
--radius-xl:   1rem
--radius-2xl:  1.5rem
--radius-full: 9999px
```

---

### Sombras (tono cálido)

```css
--shadow-sm: 0 1px 2px oklch(0.18 0.02 80 / 0.06)
--shadow-md: 0 4px 12px oklch(0.18 0.02 80 / 0.09)
--shadow-lg: 0 12px 32px oklch(0.18 0.02 80 / 0.13)
```

---

### Transición global

```css
--transition: 180ms cubic-bezier(0.16, 1, 0.3, 1)
```

---

### Anchos de contenido

```css
--content-narrow:  640px
--content-default: 960px
--content-wide:    1200px   /* usado en .view-container */
--sidebar-w:       240px
--header-h:        64px
```

---

## 9. Layout del Panel de Administración

El layout usa CSS Grid de dos columnas y dos filas. Es light theme fijo — nunca mezclar estilos oscuros con claros en la misma vista.

```
┌─────────────────────────────────────────────┐
│  HEADER (grid-column: 1 / -1, row: 1)       │  altura: 64px, fondo: --color-surface
├──────────────┬──────────────────────────────┤
│  SIDEBAR     │  MAIN CONTENT               │
│  (col: 1,    │  (col: 2, row: 2)           │
│   row: 2)    │  fondo: --color-bg          │
│  240px       │  overflow-y: auto           │
│  fondo:      │                             │
│  surface     │  .view-container            │
│  border-right│  max-width: 1200px          │
│              │  padding: space-8 space-6   │
└──────────────┴──────────────────────────────┘
```

**Header:** sticky top 0, z-index 100, border-bottom 1px solid --color-border. Contiene logotipo, email del usuario y botón de logout.

**Sidebar:** sticky top: 64px, height: calc(100vh - 64px), overflow-y: auto. Grupos de navegación con etiquetas de sección en uppercase xs. El ítem activo tiene `background: --color-primary-subtle; color: --color-primary`.

**Nav items activos:** fondo `--color-primary-subtle` (#E9F9F8), texto `--color-primary` (#00AFAA), font-weight 600.

---

## 10. Clases CSS del Sistema — Referencia Rápida

Todas las clases viven en `src/app/globals.css`. No usar clases de Tailwind directamente en los componentes.

### Layout y estructura
```
.admin-shell        → grid principal (header + sidebar + main)
.admin-header       → barra superior
.admin-sidebar      → menú lateral
.admin-main         → área de contenido
.view-container     → max-width + padding interno de cada página
.page-header        → flex row entre título y acciones de página
.page-title         → h1 de sección (Cabinet Grotesk 800, text-2xl)
.page-subtitle      → párrafo descriptivo bajo el título
.nav-section-label  → etiqueta de grupo en sidebar
.nav-item           → ítem de navegación
.nav-item.active    → ítem seleccionado
```

### Botones
```
.btn                → base
.btn-primary        → teal sólido, texto blanco
.btn-secondary      → fondo surface, borde border, texto dark
.btn-ghost          → transparente, texto primary
.btn-danger         → fondo error-highlight, texto error
.btn-sm             → tamaño pequeño (text-xs, padding reducido)
.btn-lg             → tamaño grande
.btn-full           → width 100%
```

### Badges
```
.badge              → base (inline-flex, border-radius-full)
.badge-dot          → añade punto de color antes del texto (::before)
.badge-primary      → fondo primary-highlight, texto primary
.badge-success      → fondo success-highlight, texto success
.badge-error        → fondo error-highlight, texto error
.badge-warning      → fondo warning-highlight, texto warning
.badge-info         → fondo info-highlight, texto info
.badge-amber        → fondo amber-highlight, texto amber
.badge-neutral      → fondo surface-offset, texto muted
```

### Formularios
```
.input-group        → flex column con gap-2 (label + campo)
.input              → campo base (input, select, textarea)
.required           → asterisco rojo en labels obligatorios
```

El input en focus recibe `border-color: --color-primary` y `box-shadow: 0 0 0 3px --color-primary-highlight`.

### Tablas
```
.table-wrapper      → contenedor con border-radius-xl, border, shadow-sm
.table              → table base (border-collapse, font-sm)
.table-empty        → estado vacío centrado con icono SVG
```

### Cards y métricas
```
.card               → superficie con borde, radio-xl, shadow-sm, padding-6
.card-header        → flex row con border-bottom y margin-bottom
.card-title         → título de card (Cabinet Grotesk 700, text-lg)
.metrics-grid       → grid auto-fit minmax(200px, 1fr)
.metric-card        → card de KPI con hover lift
.metric-icon        → contenedor cuadrado 40px con radio-md y color de fondo
.metric-icon-primary / -success / -warning / -amber
.metric-label       → etiqueta uppercase xs
.metric-value       → número grande (Cabinet Grotesk 800, text-3xl)
.metric-sub         → texto auxiliar xs muted
```

### Modales
```
.modal-backdrop     → overlay fijo con blur, z-index 900
.modal              → contenedor (max-width 520px, surface, radius-2xl, shadow-xl)
.modal-header       → flex con título y botón de cierre
.modal-title        → Cabinet Grotesk 700, text-xl
.modal-close        → botón icono X
.modal-body         → flex column con gap-5, padding-6
.modal-footer       → flex row justify-end, border-top, padding-5/6
```

Los modales en Client Components deben usar `createPortal(modal, document.body)` con un estado `mounted` para evitar errores de hidratación en SSR.

### Alertas y feedback
```
.alert              → base (flex, padding, radius-md, text-sm)
.alert-error        → fondo error-highlight, texto error, border sutil
.alert-success      → fondo success-highlight, texto success
.alert-warning      → fondo warning-highlight, texto warning
.alert-info         → fondo info-highlight, texto info
.spinner            → animación de carga circular (border-radius 50%, animation spin)
```

### Filtros y búsqueda
```
.filters-bar        → flex wrap con gap-3
.filter-select      → select con flecha custom
.search-wrapper     → position relative con icono SVG dentro
.search-input       → input con padding-left para el icono
```

---

## 11. Convenciones de Código

### Iconos

**Nunca usar emojis.** Siempre usar SVGs inline con:
- `width` y `height` como atributos HTML explícitos (no solo en CSS)
- `viewBox="0 0 24 24"`
- `fill="none" stroke="currentColor" strokeWidth="2"`
- En el sidebar: añadir `style={{flexShrink:0}}` para evitar que se compriman

```tsx
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}>
  <path d="..."/>
</svg>
```

### Server Actions

Siempre devuelven un objeto tipado:

```typescript
return { ok: true }
return { ok: false, error: 'mensaje' }
```

Siempre llaman `revalidatePath()` al finalizar con éxito para actualizar la caché de las páginas afectadas.

### Identificadores de cliente

Formato: `CLI-XXXX` (4 letras/números aleatorios en mayúsculas). Se genera con `Math.random()` en el Server Action al crear el cliente.

### Contraseñas temporales

Se generan en el servidor con `crypto.getRandomValues()` y se muestran al super admin una sola vez tras crear el cliente. El hash + salt se almacena en la base de datos, nunca la contraseña en texto plano.

### Estilos inline vs clases

Usar clases del sistema siempre que existan. Usar `style={{}}` solo para valores que varían en tiempo de ejecución (colores dinámicos, anchos calculados) o para propiedades de layout específicas del contexto que no justifican una clase reutilizable.

---

## 12. Hoja de Ruta de Módulos

| Fase | Contenido | Estado |
|---|---|---|
| Fase 0 | Panel admin: clientes, planes, pagos, dashboard | En desarrollo |
| Fase 1 | Portal cliente: auth propio, sesiones, router, permisos | Pendiente |
| Fase 2 | Ventas, Compras, Tesorería, CxC, CxP | Pendiente |
| Fase 3 | Inventario + Contabilidad simple + Plan de cuentas | Pendiente |
| Fase 4 | Dashboard cliente + Reportes exportables | Pendiente |
| Fase 5 | RR.HH. + Gestión Documental + Módulo Contable completo | Pendiente |
| Fase 6 | Multi-empresa + Consolidación + Presupuestos + CRM | Pendiente |
| Prueba piloto | Primera empresa real: la del propio desarrollador | Confirmado |

### Módulos del panel admin actualmente en desarrollo

| Módulo | Ruta | Estado |
|---|---|---|
| Dashboard | `/admin/dashboard` | Funcional |
| Clientes | `/admin/clientes` | Funcional — lista + creación |
| Planes | `/admin/planes` | Funcional — lista + edición |
| Pagos | `/admin/pagos` | Pendiente |

---

## 13. Decisiones de Arquitectura Confirmadas

1. Sin Google OAuth — Supabase Auth solo para el super admin. Usuarios cliente con auth propio.
2. Un proyecto Supabase compartido con aislamiento por `client_id` — no bases de datos separadas por cliente.
3. RLS deshabilitado inicialmente — se habilitará con políticas explícitas en fases posteriores.
4. Gasto y pago son eventos separados — CxP es el puente, sin doble registro posible.
5. Módulo Contabilidad dual — modo simple y modo contable coexistentes.
6. Módulos bloqueados visibles con call-to-action de upgrade — nunca ocultos.
7. Los registros nunca se eliminan físicamente — siempre estado `ANULADO`.
8. Multi-moneda desde V1 — tipo de cambio manual por operación.
9. Numeración correlativa protegida — un número anulado deja hueco y no se reasigna.
10. Períodos contables con bloqueo — ningún módulo puede crear registros en un período cerrado.
11. Sin emojis en ninguna parte de la interfaz — solo iconos SVG.
12. Light theme fijo en el panel admin — no mezclar estilos oscuros y claros en la misma vista.

# CLAUX — Modelo comercial: módulos à la carte sobre tres niveles

> Spec de diseño e implementación del modelo comercial. Complementa `docs/CONTEXTO.md` §5 (que define el
> **qué** del negocio); aquí está el **cómo** técnico. Ante conflicto manda CONTEXTO.md.
>
> **Estado:** IMPLEMENTADO. Dos capas encima de la otra, y conviene leerlas en ese orden:
>
> - **v2 — módulos à la carte** (junio 2026, migs. **017**/**018**): mueren los planes cerrados; el precio
>   es la suma de los módulos que el cliente enciende. Es lo que describen §§1-8.
> - **v3 — tres niveles con límites** (agosto 2026, migs. **213-216** y **218-220**; plan
>   `docs/planes/niveles-comerciales.md`): muere el eje `tarifa` (fundador/estándar, el mismo producto a dos
>   precios) y nace `clients.nivel` — **Inicial · Empresa · Pro**—, que fija a la vez **cuánto cuesta cada
>   módulo y cuánto cabe dentro**. **§3.4 es la sección canónica de esta capa**, y donde v2 y v3 se
>   contradigan manda §3.4.
>
> §2 (auditoría previa) queda como contexto histórico de por qué se hizo el primer cambio.

---

## 1. El problema en una frase (resuelto)

El código modelaba **planes cerrados con nombre** (tabla `plans`: Básico/Profesional/Empresarial, con un
precio único por plan). El modelo comercial v2 (CONTEXTO §5) es otra cosa: **una base obligatoria + módulos
sueltos que el cliente activa a la carta**, y el precio mensual de cada cliente es la **suma** de su base
más los módulos que tenga encendidos. **Ya implementado**: los planes se eliminaron y el precio se calcula
desde `modulos_catalogo` según `clients.modulos_activos` + `clients.nivel`, con ciclo mensual/anual.

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
| Mis Empresas | Hecho | **BASE, con tope de nivel** | Sin gating de módulo: cuántas empresas caben lo fija `nivel_limites.empresas` (§3.4). Fue el addon `multiempresa`, retirado en la mig. 220 |
| RRHH | Placeholder | **MÓDULO `rrhh`** | Gating; construir |
| IA | No existe | **MÓDULO `asistente_ia`** | Construir |
| Menú QR / Reservas / Docs imprenta | No existe | **FUNCIONALIDAD** (`catalogo_qr`, `reservas_citas`, `documentos_imprenta`) | Catálogo + construir |

Claves ERP heredadas (§2) que **se retiran del MVP**: `contabilidad_simple` y `modulo_contable`
(absorbidas por la base contable completa), `rol_contador_externo` (tier contable avanzado futuro),
`presupuestos` (= ofertas, ya en base), `crm`, `activos_fijos` (futuro). `compras` deja de ser flag
propio: queda bajo `inventario`. `terceros`, `tesoreria`, `ventas` dejan de necesitar flag: son base.

## 3. Arquitectura elegida: catálogo de módulos + módulos por cliente

Decisión del propietario (frente a "reutilizar la tabla plans"): es la única que cumple CONTEXTO §5 al
100% (precio compuesto real, un precio por módulo y por nivel, toggle por módulo con recálculo).

**La idea, simple:**
1. Un **catálogo** de módulos disponibles, con **un precio por nivel y moneda** (tabla
   `modulos_catalogo`: `precio_{inicial,empresa,pro}_usd` y `precio_{inicial,empresa,pro}_eur`, mig. 225).
   Seis celdas por módulo, todas editables a mano en el admin: el euro es un **precio propio**, no una
   conversión del dólar (por eso lo facturado coincide siempre con lo cobrado). Es una lista de
   "productos" que CLAUX vende. Los precios viven aquí, en datos — **nunca** en el código (`npm run audit:precios`). Cada
   entrada lleva un `tipo` (`modulo` | `funcionalidad` | `addon`) que decide cómo se agrupa y presenta
   en el admin y el portal. La contabilidad es un `modulo` más (clave `base`); el antiguo `tipo='base'`/flag
   `es_base` quedó **retirado** (068): es opcional como cualquier módulo.
2. Cada **cliente** guarda **qué módulos tiene encendidos**, en qué **nivel** (`clients.nivel`, mig. 215)
   y en qué **moneda se le factura** (`clients.moneda_facturacion`, mig. 225). Su **precio mensual de
   catálogo** = suma de los módulos encendidos (incluida la contabilidad si la contrató) leyendo **la
   columna de su nivel**, en las dos monedas: `precio_mensual_usd` y `precio_mensual_eur` se mantienen
   **siempre los dos**, y `moneda_facturacion` decide cuál se cobra. Se recalcula al togglear un módulo,
   al cambiar de nivel **y al editar un precio del catálogo** (`recalcularCuotas`, §3.4).
3. El **gating** del portal pasa a leer los módulos **del cliente** (no del plan). El resto del gating no
   cambia: `PortalSidebar` ya consume una lista de strings.

```
modulos_catalogo (lo que se vende)              clients (cada negocio)
┌───────────────────────────────────────┐       ┌────────────────────────────────────┐
│ clave           (PK)  catalogo_qr     │       │ client_id         (PK)             │
│ nombre                Menú digital    │       │ modulos_activos   [catalogo_qr,    │
│ descripcion                           │ ────► │                    reservas_citas] │
│ precio_inicial_usd/_eur  10.00/9.50   │       │ nivel             'inicial'        │
│ precio_empresa_usd/_eur  20.00/19.00  │       │ moneda_facturacion 'USD'           │
│ precio_pro_usd/_eur      25.00/24.00  │       │ precio_mensual_usd  30.00          │
│ (seis precios: 3 niveles × 2 monedas) │       │ precio_mensual_eur  28.50          │
│ tipo   'modulo|funcionalidad|addon'   │       │ descuento_pct/_desde/_hasta        │
│ paginas (JSONB) [{ruta,label,orden}]  │       │ es_socio / socio_desde             │
│ orden           (int)  20             │       │ limites_override  (JSONB)          │
│ activo          (bool) true           │       │ ciclo_facturacion 'mensual'        │
└───────────────────────────────────────┘       └────────────────────────────────────┘
        ▲                                                │
        │ nivel + moneda eligen la COLUMNA de precio     │ el nivel elige la FILA de tope
        │                                                ▼
┌───────────────────────┐              ┌──────────────────────────────────────────┐
│ niveles               │              │ nivel_limites                            │
│ clave (PK) inicial    │ ───────────► │ (nivel, dimension)  (PK)                 │
│ nombre     Inicial    │              │ base (int)   200   ·  NULL = sin tope    │
│ orden      1          │              │  p.ej. ('inicial','productos') → 200     │
└───────────────────────┘              └──────────────────────────────────────────┘
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
| **`addon`** | **No genera items** en el sidebar | No | **Asistente IA — y ya no hay más** | El gating se hace en el punto de entrada afectado |

> **Contabilidad** es un `modulo` con clave `base` (su grupo del sidebar contiene Ventas, Gastos, CxC, CxP, Tesorería, Reportes, Terceros). El tipo `base`/flag `es_base` está **retirado** (068): ya no hay categoría especial ni "siempre activa". `Monedas y tasas` se sacó de este grupo (071): es config transversal en el menú de cuenta, sin gating.

**Detalle de cada tipo:**

- **`modulo`**: Capacidad ERP contratable (incluida la **Contabilidad**, clave `base`). Agrupa varias páginas internas bajo un grupo colapsable. Si no está contratado, el grupo **no aparece** en el sidebar (regla general: todo módulo no contratado, sea del tipo que sea, se oculta — sin candados de upsell). Las rutas se protegen con `requireModulo()`.
- **`funcionalidad`**: Pieza de **ruta única** → item standalone en el sidebar, fuera de grupos. Si no está contratado, **no aparece** en el menú. Las rutas están protegidas por `requireModulo()`.
  El criterio real que decide `modulo` vs `funcionalidad` es **cuántos dominios abarca, no si es de un sector**: varios dominios → `modulo` (Contabilidad son siete páginas porque son siete entidades distintas); **un dominio con varias vistas → `funcionalidad`**, aunque tenga pestañas dentro (Catálogo QR tiene tres; el Dossier del negocio, tres). Lo único que distingue los dos tipos en `PortalSidebar.tsx` es grupo colapsable contra item suelto. Muchas funcionalidades son además de sector (Catálogo QR, Reservas), pero eso es una coincidencia frecuente, no la definición: el Dossier del negocio no es de ningún sector.
- **`addon`**: Añade una capacidad **transversal** que no vive en una página propia. **No genera navegación**; el gating se aplica en cada punto de entrada con `tieneModulo()`. En el catálogo del admin es un toggle más con su precio.
  > **Queda uno solo: `asistente_ia`.** Los addons de **capacidad** (Multiempresa, Multidossier) se retiraron en la mig. 220 — ver §3.4. La razón no es de precio: **la capacidad la vende el nivel**, y dos candados que opinan distinto sobre lo mismo acaban en que gana el «no», así que el cliente que había pagado por tener varias empresas se quedaba fuera igual. Un addon nuevo solo se justifica si añade **una capacidad**, no **más cantidad** de algo que ya existe; si es cantidad, es una dimensión de `nivel_limites`.

> **Una tabla / una página, varios módulos** (regla consagrada por Inventario + Servicios, mig. 115): un `tipo` es un paquete comercial, no una frontera de código.
> - **Tabla compartida:** Inventario y Servicios escriben la misma tabla `products`, filtrada por `tipo` (PRODUCTO/SERVICIO). No se duplica la tabla — y `servicios` ya es el nombre de la tabla de Citas. Los componentes son *modo-aware* (`modo` → `basePath`), y las escrituras gatean por el módulo del `tipo`.
> - **Página compartida:** una ruta puede pertenecer a varios módulos y se pinta **una sola vez** en el sidebar, en el grupo del primer módulo contratado de una lista de prioridad (hoy `/portal/terceros` → base › inventario › servicios; la ruta vive en las `paginas` de base y se inyecta en el anfitrión si base no está).
> - El gate de cada página es su `requireModulo` propio; los consumidores de la tabla compartida (selector de ventas, import de catálogo) usan `MODULOS_CATALOGO` = «¿tiene alguno de los módulos que escriben en `products`?».

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
  transversal en el menú de cuenta). `empresas` es accesible (editas tu empresa) y **cuántas caben lo
  decide el tope de nivel** (`nivel_limites.empresas`), comprobado en la acción de crear, no en la ruta.

> Nota de diseño: la columna `paginas` añade una capa (BD → sidebar) cuyo único beneficio real es renombrar/reordenar
> sin desplegar; ruta + icono + página viven en código igualmente. Si en el futuro estorba, revertir a un nav
> definido en código es viable (el render de grupos colapsables se conserva).

### 3.3 Receta: crear un módulo / funcionalidad / addon nuevo

Pasos repetibles (aplican a los tres `tipo`; sus diferencias, en §3.1). Sirve para construir **y** para no olvidar cómo documentarlo — que sea siempre igual es lo que evita que cada módulo se haga distinto.

1. **Datos (catálogo).** Añade una fila a `modulos_catalogo`: `clave` estable y **genérica** (nunca "menu"/"mesa", §6), `tipo`, `nombre`, **los seis precios** (`precio_{inicial,empresa,pro}_{usd,eur}`, con Empresa = Inicial ×2 y Pro = ×2,5 redondeado a 5, y el euro sembrado desde el dólar pero ajustable a mano), `orden`, y `paginas` (JSONB `[{ruta,label,orden}]`) si es `modulo`/`funcionalidad`. Precios SOLO en datos, nunca en código. Migración nueva en `supabase/migrations/` con el **número siguiente** (no reutilizar).
2. **Código de la(s) página(s).** El `page.tsx`, su ruta y su icono son **código** — crear la fila del catálogo es media operación (§3.2). Crea el `page.tsx` en la ruta declarada y su icono en el `ICON_MAP` de `PortalSidebar`. Una `ruta` sin `page.tsx` da 404.
3. **Gating (obligatorio, server-side).**
   - `modulo`/`funcionalidad`: primera línea del `page.tsx` → `requireModulo('<clave>')`. Ocultar en el sidebar NO es control de acceso.
   - `addon`: no tiene ruta propia; se gatea **dentro de la página afectada** con `tieneModulo('<clave>')` (`src/lib/modulos.ts`).
4. **¿Lleva tope? (§3.4).** Si el módulo crea filas de algo que un negocio grande tendrá en cantidad, es una **dimensión** de `nivel_limites`, no un addon de capacidad: añade su fila a `DIMENSIONES` en `src/lib/limites.ts` (tabla, `pk`, módulo y **filtro de activo verificado contra la BD**), sus tres filas a `nivel_limites`, y llama a `comprobarLimite` en **crear y desarchivar**. Después, `npm run audit:limites` — es lo único que separa un límite real de uno que no existe en silencio.
5. **Independencia (regla transversal, CONTEXTO §2).** Funciona solo; la base opera sin él. Si aprovecha otro módulo, es **llenado rápido aditivo en una dirección** (cargar algo solo si el otro está activo), nunca dependencia; su modelo de datos es propio y los vínculos a otros módulos son blandos/opcionales.
6. **UI.** Toda la pantalla sigue `skills/ui/SKILL.md` (fuente única: reglas, tablas, tokens, iconos, gotchas). Etiquetas por sector, sin jerga (§6; helper `src/lib/sector.ts`). Las server actions devuelven objeto tipado y llaman `revalidatePath`.
7. **Admin.** El toggle por cliente ya existe (`ModulosCard`, agrupado por `tipo`) y recalcula `precio_mensual_usd` y `precio_mensual_eur`. No hay que tocarlo salvo que cambie la mecánica.
8. **Documentar (una sola vez, en su sitio).** Actualiza el **mapa §2 de CONTEXTO.md** con **un bullet** en el formato estándar: *qué es (clave, tipo) · estado · puntos de entrada (ruta · vista · acciones) · pendiente*. **No** párrafos-ensayo, listas de migraciones ni RPC (viven en las migraciones y el código). Gotchas de UI → `SKILL.md`. Detalles operativos volátiles (claves de proveedor, quirks) → memoria del agente. Skill nueva → regístrala en `AGENTS.md`.

### 3.4 Niveles y límites de capacidad (v3 — sección canónica)

> Migs. **213-216** y **218-220** (agosto 2026). Plan y las 18 decisiones cerradas con el propietario:
> `docs/planes/niveles-comerciales.md`. **Donde §§1-3.3 y §5 se contradigan con esto, manda esto.**

**Qué murió.** El eje `clients.tarifa` (`fundador` | `estandar`) era el mismo producto a dos precios según
el orden de llegada: ni daba razón para pagar más, ni caducaba nunca. La columna se **borró** en la mig.
215, y con ella `LIMITE_FUNDADOR` del presupuesto.

**Qué manda ahora.** `clients.nivel` ∈ `inicial` | `empresa` | `pro` (PK de la tabla `niveles`, cuyo
`nombre` visible edita el propietario). El nivel decide **dos cosas a la vez**:

1. **Cuánto cuesta cada módulo** — elige la columna de `modulos_catalogo`.
   Regla plana y sin excepciones: **Empresa = Inicial ×2 · Pro = Inicial ×2,5 redondeado a múltiplo de 5.**
2. **Cuánto cabe dentro** — elige la fila de `nivel_limites`.

Que sean **dos efectos de un solo eje** es lo que hace el modelo explicable en una frase: *un negocio más
grande paga más por lo mismo y le cabe más*. Qué módulos se contratan **sigue siendo à la carte** y no
depende del nivel.

#### Las dos tablas

| Tabla | Forma | Quién la edita |
|---|---|---|
| `niveles` | `clave` (PK) · `nombre` · `descripcion` · `orden` | `/admin/niveles` |
| `nivel_limites` | PK `(nivel, dimension)` · `base` int, **`null` = sin tope** | `/admin/niveles` (rejilla 10 × 3) |
| `clients.limites_override` | JSONB `{dimension: n}` — excepción de un tope suelto sin mover de nivel | ficha del cliente |

Las dos son **globales, no del tenant**: no llevan `client_id`, no entran en `eliminar_cliente()` y su RLS
se puso en la mig. 213. Son un catálogo, como `modulos_catalogo`.

#### Las diez dimensiones

`src/lib/limites.ts` es **el único sitio que sabe contar**; todo lo demás lo llama. Su `DIMENSIONES` mapea
cada dimensión a su tabla, su `pk`, su módulo y **su filtro de «está activo»**:

| Dimensión | Tabla | Módulo | Filtro de activo |
|---|---|---|---|
| `empresas` | `empresas` | — (sin módulo) | `estado = 'ACTIVO'` |
| `usuarios_portal` | `client_users` | — (sin módulo) | `estado = 'ACTIVO'` |
| `productos` | `products` | `inventario` | `estado = 'ACTIVO'` + `tipo = 'PRODUCTO'` |
| `servicios` | `products` | `servicios` | `estado = 'ACTIVO'` + `tipo = 'SERVICIO'` |
| `trabajadores` | `empleados` | `rrhh` | `fecha_baja is null` — ni `activo` ni `estado`: una fecha |
| `almacenes` | `almacenes` | `inventario` | `activo = true` (masculino) |
| `cuentas_tesoreria` | `cuentas` | `base` | `activa = true` (femenino) + `es_apertura = false` |
| `puntos_venta` | `cajas` | `caja` | `activa = true` (femenino) |
| `dossiers` | `dossiers` | `dossier` | **ninguno**: su `estado` es BORRADOR/PUBLICADO, no archivado |
| `ia_conversaciones` | `ia_uso` | `asistente_ia` | uso del mes en curso, no filas activas |

> **Esta tabla es el punto frágil de todo el sistema de límites.** No hay convención para «esto está
> activo» —`estado`, `activo`, `activa` (femenino), `fecha_baja is null`— y **PostgREST no ignora la
> columna que sobra: tumba la consulta entera**. Con el `?? 0` habitual el conteo cae a cero,
> `usado + 1 <= limite` se cumple siempre y **el límite deja de existir en silencio**. Por eso existe
> `npm run audit:limites`, que comprueba las nueve que se cuentan por filas contra el esquema vivo
> —tabla, `pk`, `client_id` y cada columna del filtro— y que las diez tengan su fila en
> `nivel_limites`.
>
> Dos trampas propias: **`products` tiene dos columnas de estado** (`activo` boolean está MUERTA; la que
> mandan archivar/restaurar es `estado`), y **la misma tabla son dos dimensiones** — con un solo contador,
> contratar Servicios se comería el cupo de Inventario, y los módulos son independientes. Y las
> cuentas de **Apertura** no cuentan: son fontanería del importador (mig. 130), el dueño no las creó ni las
> ve en su listado, y cobrarle cupo por ellas sería cobrarle por migrar sus datos.

**Por cliente, no por empresa.** No es una preferencia: `products` y `client_users` no tienen `empresa_id`,
así que no había dónde agarrar un tope por empresa aunque se quisiera.

#### Las tres reglas de comportamiento

1. **Solo cuenta lo activo.** Archivar libera cupo, y es deliberado: el negocio que retira producto merece
   recuperar el sitio.
2. **Desarchivar cuenta como crear**, con la misma comprobación. Sin esto, archivar 50 productos para meter
   50 nuevos y luego desarchivar los viejos deja al cliente en 250 con derecho a 200.
3. **Nada se rompe: solo se bloquea añadir.** Un cliente puede quedar **por encima** (migrado, o rebajado de
   nivel). No se archiva nada solo, no se corta nada: se le impide crear y desarchivar, y se le dice.

**Cómo se avisa** (nadie choca de frente): contador discreto en cada vista limitada
(`components/portal/CupoNivel.tsx`, que **no pinta nada si el conteo falla** — inventar un número sería
peor que callarse) · aviso en la bandeja al **90 %** · correo `limite_alcanzado` al **100 %**. El correo
cuelga de que el aviso sea *nuevo*, así que se manda una vez por dimensión y mes sin llevar una tabla de
envíos aparte. El botón de la pantalla llena pide **subir de nivel** con
`registrarInteresModulo('nivel_superior', …)`: cae en `/admin/soporte` y en **Ventas → Ampliaciones** como
una petición más — un `mailto:` no dejaría rastro de quién quiso pagar.

**La IA es el único tope que sobrevive en Pro** (5.000 conv/mes). Al agotarlo el asistente **no se apaga**:
cae al modelo gratuito. Lo que se promete es que siga respondiendo, no consumo ilimitado del modelo caro.

#### El precio que se cobra

`clients.precio_mensual_usd` y `clients.precio_mensual_eur` son una **caché del precio de catálogo**: Σ de
los módulos activos en la columna del nivel, **sin descuento** y contando **solo
`modulos_catalogo.activo = true`** (`sumarModulos` en `src/lib/niveles.ts`). Las dos se mantienen siempre,
aunque al cliente se le cobre en una: `moneda_facturacion` elige cuál manda (`precioMensualEfectivo` /
`monedaDelCliente` en `src/lib/moneda-claux.ts`). Encima van dos cosas, que viven aparte a propósito:

- **Descuento con vigencia** — `descuento_pct` + `descuento_desde`/`descuento_hasta`. Caduca solo; fuera de
  fechas el precio vuelve al de catálogo sin que nadie se acuerde. Ojo: **«hoy» se calcula con `hoyEnTz()`**,
  no con `toISOString()` — en La Habana, a partir de las 20:00 el UTC ya es mañana y el descuento se caía
  cuatro horas antes.
- **Socio CLAUX** — `es_socio` + `socio_desde`: cuota **$0** con insignia propia en el portal. Es una
  **bandera comercial que se pulsa a mano en la ficha del cliente**; ninguna migración la marca. No
  confundir con `admin_users.rol = 'partner'` (mig. 205), que es el revendedor externo.

**Cambiar un precio del catálogo rehace la caché de toda la cartera** (`recalcularCuotas` en
`src/lib/catalogo-precios.ts`). Antes solo se recalculaba al togglear módulos: cambiar un precio dejaba a
la cartera entera pagando el viejo, en silencio. Y como es el botón más peligroso del panel,
`/admin/modulos` enseña con `impactoDeCambios` **a quién le sube, y de cuánto a cuánto, antes de guardar**.

**Las dos monedas no se suman ni se convierten nunca.** El MRR, lo cobrado del mes y el pendiente del
portal se agrupan por moneda y se enseñan como `$X · €Y` (`totalPorMoneda` / `importesPorMoneda`). Cada
pago y cada presupuesto guardan **su** moneda y no se reetiquetan; el prorrateo de un cambio de ciclo se
niega —diciéndolo en pantalla— si el último pago fue en otra moneda. La moneda **viaja en la versión del
documento**, así que cambiar `moneda_facturacion` en la ficha deja el contrato y el Anexo I pendientes de
firma: el cliente que pasa de dólar a euro vuelve a firmar en su moneda, y el resto de la cartera no.

**El Anexo I firmado documenta el precio de catálogo, no el efectivo**: si firmara el precio con descuento,
el día que el descuento caduca la cadena de versión se movería sola y el cliente tendría que volver a
firmar por algo que él no cambió. Y al generar el anexo **manda el nivel del presupuesto, no el del
cliente**: el documento describe lo que se firmó.

#### Superficies

| Dónde | Qué hace |
|---|---|
| `/admin/niveles` | Nombre, descripción y la rejilla 10 × 3 de topes. Un número aquí mueve a la vez el bloqueo del portal, la tarjeta de la landing y las bandas del diagnóstico |
| `/admin/modulos` | Rejilla de seis precios (3 niveles × 2 monedas), toda editable a mano · **sembrar** una columna desde otra (×multiplicador + redondeo: siembra, no manda) · previsualización de impacto |
| Ficha del cliente | `CondicionesCard` (nivel, descuento, socio) y `CapacidadCard` (usado/tope por dimensión, con override) |
| Landing | Tres tarjetas de nivel con sus topes en vivo. **Sin precios** — `DIMENSIONES_LANDING` elige cuáles se enseñan y vive en código, porque depende del diseño de la tarjeta, no del negocio |
| Diagnóstico | Tres preguntas de tamaño cuyas **bandas se derivan de los topes vivos** (`lib/publico/tamano.ts`); guarda `nivel_recomendado` en el lead (mig. 219) |
| Presupuesto | Arranca en **Inicial** y propone nivel según los volúmenes tecleados; cuota e instalación, dos cifras separadas |

#### Centinelas

`npm run audit` corre los seis de una vez. Tres nacieron con esta capa:

- **`audit:limites`** — la `DIMENSIONES` contra la BD viva, las filas de `nivel_limites` en los dos
  sentidos, y que **todo `insert`/`upsert` en tabla limitada pase por `comprobarLimite`**.
- **`audit:nivel`** — que toda clave de módulo citada en código exista en el catálogo, que las plantillas de
  sector y el diagnóstico no apunten a claves muertas, y que los seis precios (tres niveles × dos monedas) estén y sean monótonos.
  Marca además la clave **inactiva y sin ningún cliente que la tenga**: un módulo retirado se le sigue
  sirviendo a quien lo contrató, pero cuando no lo tiene nadie, citarlo es código muerto que apaga algo en
  silencio. `SIN_VENDER_AUN` justifica lo contrario (`documentos_imprenta`: construido entero, sin activar).
- **`audit:precios`** — ningún importe de CLAUX cableado en código, ni en un campo ni en un texto que el
  usuario lee.

## 4. Migraciones aplicadas

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
> movimientos. Las claves ERP heredadas retiradas del MVP (`modulo_contable`, `rol_contador_externo`,
> `presupuestos`, `crm`, `activos_fijos`) **no se siembran**; cuando se diseñe el tier contable avanzado o
> marketing, se añaden como filas nuevas.

**Los niveles (v3, agosto 2026 — detalle en §3.4).** El DDL vive en los ficheros; aquí solo qué hizo cada una:

| Nº | Qué |
|---|---|
| **213** | `niveles` + `nivel_limites` + semilla de los tres niveles y las diez dimensiones (con su RLS) |
| **214** | `modulos_catalogo`: `precio_fundador_usd`→`precio_inicial_usd`, `precio_estandar_usd`→`precio_empresa_usd`, **nace** `precio_pro_usd` |
| **215** | `clients`: `tarifa`→`nivel` + CHECK · `descuento_pct`/`_desde`/`_hasta` · `es_socio`/`socio_desde` · `limites_override` |
| **216** | `presupuestos_instalacion.tarifa`→`nivel` (`tarifa_hora_usd` **no** se toca: es la tarifa del instalador, otra cosa) |
| **218** | Rescata la versión del Anexo I ya firmado. No estaba en el plan: sin ella, el cambio de nomenclatura habría pedido a todo el mundo volver a firmar lo mismo |
| **219** | `diagnostico_leads.nivel_recomendado` / `respuestas_tamano`, **nullable**: a los leads viejos no se les inventa un nivel |
| **220** | **Retirada de los addons de capacidad**: `multiempresa` y `multidossier` a `activo = false` y fuera de `modulos_activos` · caché `precio_mensual_usd` rehecha para toda la cartera · plantillas de correo `limite_alcanzado` y `socio_ampliado` |

| **225** | **Precio propio en euros**: `modulos_catalogo.precio_{inicial,empresa,pro}_eur` (sembrados desde el dólar, editables a mano) · `clients.precio_mensual_eur` + `moneda_facturacion` · `moneda` en `payments`, `presupuestos_instalacion` y `presupuesto_parametros.tarifa_hora_eur` |

> **No se borran, se desactivan.** Las dos filas siguen en `modulos_catalogo`: los anexos, presupuestos y
> facturas ya emitidos citan la clave y necesitan su nombre para poder leerse dentro de diez años.

## 5. Cambios de código al implementar (resumen)

- **Gating** — `src/app/portal/(app)/layout.tsx`: cambiar la query que hoy lee `plans.modulos` por
  `clients.modulos_activos` (la base es un módulo opcional; no se fuerza). Sigue pasando una lista de strings al sidebar.
- **Sidebar** — `src/components/portal/PortalSidebar.tsx`: reestructurar `buildNav` a la frontera nueva.
  Grupo **Contabilidad** (base, siempre visible): Ventas, Gastos/Cobros, Cuentas por cobrar, Cuentas por
  pagar, Tesorería, Reportes, Terceros. (`Monedas y tasas` vive en el menú de cuenta, transversal.) Grupo **Inventario** (`modulo: inventario`): Productos,
  Almacenes, Compras, Movimientos. Grupos **RRHH** e **IA** (`asistente_ia`). Mis Empresas vive en el menú
  de cuenta, sin grupo propio (§3.4: no es un módulo, es un tope de nivel). Grupo **Funcionalidades**: Catálogo QR, Reservas, Documentos imprenta. Implica mover
  Productos/Almacenes fuera del grupo "Catálogo" y Mis Empresas a su módulo, Compras de Gestión a
  Inventario, y **quitar** el item Contabilidad (`modulo_contable`).
- **Empresas** — la gestión está siempre accesible; **cuántas caben lo decide el tope de nivel** (§3.4),
  comprobado al crear. El scoping por `empresa_id` se mantiene intacto.
- **Editor de líneas de factura** — `src/app/portal/(app)/ventas/_DocumentoLineasEditor.tsx` ya soporta
  entrada manual y selección por `datalist`. Gatear la carga de `productos` por el módulo `inventario` en
  el fetch del formulario (`_FacturaFormModal`/`_OfertaFormModal`): sin Inventario → `productos = []`
  (manual puro); con Inventario → se cargan. No cambia la lógica de cálculo.
- **Admin** — en el detalle de cliente (`src/app/admin/(protected)/clientes/[client_id]/`): UI de **toggle
  por módulo/funcionalidad** (agrupada por `tipo`; contabilidad incluida como un módulo toggleable más) que
  actualiza `modulos_activos` y **recalcula** `precio_mensual_usd`/`_eur` = Σ precios de lo activo en la
  columna de `clients.nivel`. Server action en `src/app/actions/clientes.ts`.
- **Catálogo** — pantalla admin para CRUD de `modulos_catalogo` (**los seis precios**, `tipo`, `activo`), con
  sembrado de columna y previsualización de impacto (§3.4).
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

## 7. La IA es el único addon, y va por cupo

`asistente_ia` es **una sola fila** del catálogo, con su precio en cada nivel como cualquier otra pieza. No se
trocea por caso de uso, y desde la mig. 220 es **el único `tipo = 'addon'` que se vende**: los de capacidad se
retiraron porque la capacidad la vende el nivel (§3.4). **Es un `addon`** (reclasificado de módulo en la mig. 071): no genera navegación propia en el sidebar;
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
- **Va por cupo, y el cupo lo fija el nivel** (`ia_conversaciones` en `nivel_limites`: hoy 500 / 1.500 / 5.000
  al mes). Es la **única dimensión con tope también en Pro** —el modelo caro lo pagamos nosotros— y la única
  que se mide por uso del mes y no por filas activas. **Agotado el cupo el asistente no se apaga**: cae al
  modelo gratuito. Lo que se promete es que siga respondiendo, no consumo ilimitado.

## 8. Estado de implementación

**Hecho — v2, el sistema à la carte (migraciones 017–025):**
- [x] **017** aplicada: `modulos_catalogo` (`tipo`) + columnas `clients.modulos_activos`/`tarifa`/`precio_mensual_usd`; seed de 8 filas. *(`tarifa` murió en la 215.)*
- [x] **Gating** del portal lee `clients.modulos_activos` (`layout.tsx`).
- [x] **Sidebar** reestructurado a la frontera nueva (Contabilidad/base, Inventario, RRHH, IA, Funcionalidades); item Contabilidad (`modulo_contable`) retirado.
- [x] **Gating de Empresas** por módulo `multiempresa` (OFF → máx. 1 empresa); `empresa_id` intacto. *(Sustituido en v3 por el tope de nivel; el addon se retiró en la 220.)*
- [x] **Admin toggle** en detalle de cliente (`ModulosCard`, agrupado por `tipo`; contabilidad toggleable como un módulo más) + `setModulosCliente` (recalcula `precio_mensual_usd`).
- [x] **Admin catálogo** `/admin/modulos` (CRUD de precios/`activo`).
- [x] **Backfill** de clientes sin módulos → `['base']` (en 018).
- [x] **Planes eliminados (018)**: tabla `plans` borrada, `plan_id` vaciado, `/admin/planes` + `planes-constants.ts` + `cambiarPlan` retirados.
- [x] **Ciclo de facturación** `clients.ciclo_facturacion` (mensual/anual con descuento configurable); importe del cobro derivado en `obtenerDatosPagoDefecto`.
- [x] **Pago de configuración** `payments.concepto` (`suscripcion`|`configuracion`); registrado opcionalmente al crear cliente; ajustes en `/admin/configuracion`.
- [x] **Tipo `addon`** (025): cuarto tipo del catálogo; `multiempresa` reclasificado como addon (sin item de sidebar, gating en la página). Toggle en `ModulosCard` con grupo «Addons». *(El tipo sigue vivo, pero desde la 220 solo lo usa `asistente_ia`.)*
- [x] **Sidebar dirigido por datos** (024): columna `paginas` (JSONB); el sidebar renderiza grupos colapsables desde el catálogo. Caveats y guards en §3.2.
- [x] **Guards de ruta** `requireModulo()` en todas las rutas gateadas: catálogo QR, reservas, docs imprenta, IA, `inventario` (productos/almacenes/compras/movimientos) y RRHH. (Ocultar en el sidebar no protege; el guard sí.)
- [x] **Base contable completa (Fase 4)**: Tesorería, Gastos/Cobros, CxC/CxP y Reportes financieros construidos; selector de productos del editor de líneas gateado por `inventario`.
- [x] **Asistente IA v1 (mig. 071)**: `asistente_ia` reclasificado de módulo a **addon**; núcleo `src/lib/ia/` (provider OpenCode Zen + contexto acotado + agente + medición + intérprete de bot), touchpoints en Dashboard, chat flotante del dueño, sección de Perfil (nombre + uso) y admin de modelo/consumo. Capa de Telegram en lenguaje natural sobre el motor híbrido. Detalle en CONTEXTO §2.
- [x] **Catálogo QR (mig. 077, julio 2026)**: funcionalidad `catalogo_qr` construida — modelo propio (`catalogo_categorias`/`catalogo_items`) independiente de Inventario, editor `/portal/catalogo`, público `/[slug]/catalogo` (ISR), imágenes optimizadas cliente+servidor, QR, PWA/offline, IA de cara al dueño (autocompletar + insight). Detalle en CONTEXTO §2.
- [x] **Caja / POS offline (mig. 089, julio 2026)**: nuevo módulo `caja` — PWA instalable offline (`/caja`) + sync idempotente (`/caja/api/{seed,sync}`); detalle propio (`caja_tickets`/`caja_ticket_lineas`) y resúmenes por cierre a Tesorería (`origen='CAJA'`) e Inventario (`origen='VENTA'`). Portal `/portal/caja`. Detalle en CONTEXTO §2.

- [x] **Módulo `servicios` (mig. 115, julio 2026)**: `servicios` pasa de *funcionalidad* barata a **módulo** propio ($15/$25, como Inventario), con página propia `/portal/servicios`. **Separación total**: Inventario cataloga solo físicos; ambos comparten la **tabla** `products` (filtro por `tipo`), no la página. Se **retiró la absorción** (`ABSORCIONES`/`aplicarAbsorciones`/`estaAbsorbida`): son dos productos independientes que un negocio puede querer a la vez. `MODULOS_CATALOGO` se conserva solo para los consumidores de la tabla compartida (selector de ventas, import de catálogo); el gate de cada página es su `requireModulo`. Migs. 113/114 (la funcionalidad) retiradas. **Fase B hecha (mig. 116):** tabla `suscripciones` + página `/portal/suscripciones` + widget de dashboard + pestaña en la ficha del cliente; «vencida» derivada (`src/lib/suscripciones.ts`). Detalle en CONTEXTO §2; **fases C+ pendientes** (avisos, facturación del período, CxP/margen) en el plan `docs/planes/modulo-servicios.md`.

**Hecho — v3, los tres niveles (migraciones 213-216 y 218-220, agosto 2026; detalle en §3.4):**
- [x] **Datos**: `niveles` + `nivel_limites` + los tres precios del catálogo + `clients.nivel`/descuento/socio/`limites_override` + `presupuestos_instalacion.nivel`. Muere `clients.tarifa`.
- [x] **Núcleo**: `src/lib/limites.ts` (las diez dimensiones, contar, comparar, mensajes) y `src/lib/niveles.ts` (columna de precio, suma, normalización).
- [x] **Cableado**: `comprobarLimite` en crear **y desarchivar** de las nueve dimensiones de filas; el importador avisa y corta (`motor.ts`); el `sync` de Caja **no** comprueba nada, a propósito — un TPV offline que rechaza un ticket por cupo pierde una venta ya cobrada.
- [x] **Precio**: `calcularPrecioMensual` a tres columnas, descuento con vigencia, socio a $0, y `recalcularCuotas` al editar el catálogo.
- [x] **Admin**: `/admin/niveles` · `/admin/modulos` a tres columnas + sembrar columna + previsualización de impacto · `CondicionesCard` y `CapacidadCard` en la ficha del cliente.
- [x] **Portal**: contadores (`CupoNivel`), aviso de exceso, escáner al 90 % a la bandeja y correo `limite_alcanzado` al 100 %, botón «Subir de nivel» al embudo de Ampliaciones.
- [x] **Públicas**: tres tarjetas de nivel en la landing (sin precios) · diagnóstico que recomienda nivel con bandas derivadas de los topes vivos · presupuesto que propone nivel.
- [x] **Centinelas**: `audit:limites`, `audit:nivel`, `audit:precios` y el paraguas `npm run audit`.
- [x] **Retirada** de `multiempresa` y `multidossier` (220), incluidas sus fichas de Academia, que **cambian de categoría en vez de morir**: nace el tipo de ficha `capacidad` («Lo decide tu nivel»).

**Pendiente:**
- [ ] **Build-out de módulos**: funcionalidad por sector `documentos_imprenta` — construida entera y **sin activar**: falta la decisión comercial, no el código (`SIN_VENDER_AUN` en `audit:nivel`). Chat embebido de IA en la mini-web pública para clientes finales (requiere medición/rate-limit propios de tráfico anónimo).
- [ ] **Autoservicio de cambio de nivel**: hoy el nivel lo mueve el equipo desde la ficha. Anotado en `mejoras-futuras.md`.

## 9. Discrepancias detectadas (registro, con recomendación)

| # | Discrepancia | Recomendación |
|---|---|---|
| D1 | `actualizarPlan` guardaba `plans.modulos` como CSV y rompía el gating al editar | **Resuelto** (CONTEXTO §2, ahora array). Queda moot al pasar el gating a `clients.modulos_activos`. |
| D2 | `plans.precio_usd` / `nivel` / `modalidad` (precio único por tier) | Superado por el precio compuesto (`clients.precio_mensual_usd`). |
| D3 | `docs/CLAUX-LEGACY.md` usaba nombres Básico/Profesional/Empresarial | **Resuelto: LEGACY eliminado** (contenido vivo absorbido en CONTEXTO/SKILL). Ya no hay tercera fuente que contradiga. |
| D4 | `plans.max_empresas` / `max_usuarios` (límites en el plan) | **Resuelto de verdad en v3** (§3.4): los dos son dimensiones de `nivel_limites` (`empresas` y `usuarios_portal`), y con ellos otras ocho. La respuesta intermedia —el addon `multiempresa`— duró de junio a agosto de 2026 y se retiró en la mig. 220: la capacidad la vende el nivel. `max_usuarios` deja de ser «futuro». |
| D5 | `BloqueadoScreen` solo cubre SUSPENDIDO/VENCIDO; la degradación gradual (aviso→degradación→corte, CONTEXTO §8) está parcial | Anotado para la fase de corte por impago. |

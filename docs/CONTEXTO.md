# CLAUX — Contexto del proyecto para desarrollo
> Fuente de verdad del producto y la arquitectura. Vive en docs/ y se lee completo antes de cualquier tarea (ver AGENTS.md). Derivado del plan de negocio de junio 2026 (v2).

## 1. Qué es CLAUX

Plataforma SaaS todo en uno para digitalizar negocios locales cubanos. El vertical de lanzamiento son los restaurantes, pero la plataforma es multi-sector por configuración (gimnasios, salones de belleza, tiendas, servicios): el núcleo es el mismo y cambian la terminología y los módulos típicos, vía plantillas de onboarding por sector. Por eso la nomenclatura interna de los módulos públicos es genérica: **"catálogo digital QR"** (que en restaurantes se renderiza como "menú") y **"reservas y citas"** (mesas, citas por profesional o clases según el sector). Una sola aplicación multi-tenant: cada negocio (tenant) ve y configura únicamente los módulos que tiene activos. El cliente accede casi siempre desde móvil con conexión lenta. La IA es el eje de la comunicación comercial del producto; internamente se usa solo donde aporta (ver principios 6 y 9). El equipo opera desde España y Cuba; el hosting y los servicios externos se contratan desde España/EEUU.

## 2. Punto de partida del código — AUDITADO (junio 2026)

El desarrollo NO parte de cero. El repositorio existente (`DamianMartinMayedo/claux`) fue auditado y su estado es el siguiente:

**Stack confirmado:** Next.js 16.2.4 (App Router, TypeScript, Server Actions, middleware en `src/proxy.ts`), React 19, Supabase (PostgreSQL), Tailwind v4 solo como reset — el estilo real es el design system propio de CSS custom properties documentado en `docs/CLAUX-LEGACY.md` (teal + ámbar, Cabinet Grotesk + Satoshi, light/dark). Despliegue previsto en Vercel. `html2pdf.js` para PDFs de facturas. Este stack se mantiene.

**Lo que YA existe y se reutiliza:**
- **Multi-tenancy real** por `client_id` en todas las tablas. Doble autenticación: super admin con Supabase Auth (`/admin`) y usuarios de cliente con tabla `client_users` + JWT HMAC propio en cookie httpOnly (`/portal`). Roles: `admin_empresa`, `usuario`, `solo_lectura`.
- **Feature flags operativos**: los módulos activos del cliente (`clients.modulos_activos`) determinan qué módulos se ven; el sidebar del portal candado los no contratados (visibles pero bloqueados, con upgrade como CTA).
- **Admin interno completo** (`/admin`): clientes con estados ACTIVO/TRIAL/GRACIA/VENCIDO/SUSPENDIDO, periodo de gracia con motivo y fecha, catálogo de módulos con precios en USD (`/admin/modulos`), toggle de módulos por cliente con recálculo automático del precio, registro de pagos (suscripción y pago único de configuración) con reactivación automática, dashboard de vencimientos, log de auditoría y pantalla de bloqueo con degradación (`BloqueadoScreen`).
- **Portal cliente (ERP de gestión)**: multi-empresa, multi-moneda con pares de tasa (CUP/MLC/USD/EUR), terceros, productos con categorías, almacenes, ventas (facturas y ofertas con numeración correlativa tipo `FAC-2026-0001`, estados BORRADOR/CONFIRMADO/ANULADO, anulación sin borrado físico, PDF) y gestión de usuarios.

**Declarado pero sin implementar** (en navegación, sin páginas): tesorería, gastos/cobros, cuentas por cobrar/pagar y reportes financieros — todos pasan a la **base contable** (ver §5); compras y movimientos quedan en el **módulo inventario** (que ya tiene almacenes y productos); RRHH y asistente IA son módulos. El placeholder "contabilidad" (`modulo_contable`) se retira del MVP: la base ya cubre la contabilidad simple completa y un tier contable avanzado (partida doble / plan de cuentas oficial) es trabajo futuro.

**Lo que NO existe y constituye el trabajo de Fase 0** (la raíz redirige hoy a `/admin/login`): toda la capa pública — landing + formulario de diagnóstico + informe (embudo), menú digital QR + mini-web por negocio, sistema de reservas con panel, bot de Telegram y capa de IA. Las páginas públicas se construyen estáticas/pre-renderizadas (SSG/ISR de Next) fuera del portal: deben cumplir el presupuesto de rendimiento de la sección 3 y NO cargar el peso del ERP. Requerirán además una vía de lectura pública de datos (políticas RLS de solo lectura para menú/mini-web o generación estática), ya que hoy todo el acceso es vía `service_role` en servidor.

**Deuda técnica a corregir pronto:** (1) el hash de contraseñas de `client_users` es SHA-256+salt — migrar a scrypt o argon2 antes de tener clientes reales; (2) las migraciones de `supabase/migrations` empiezan en 001 sobre tablas creadas a mano en el SQL Editor — volcar el esquema base completo al repo para que la base de datos sea reconstruible; (3) la seguridad entre tenants depende de filtrar por `client_id` en cada query (no hay políticas RLS por tenant): toda query nueva debe revisarse contra esta regla.

**Nota de nomenclatura:** el sistema de planes cerrados (Básico/Profesional/Empresarial, tabla `plans`) **se eliminó por completo** (migración 018: tabla borrada, `plan_id` vaciado e inerte). Las referencias a esos planes en `docs/CLAUX-LEGACY.md` son obsoletas. El modelo vigente es **base contable + módulos à la carte** (sección 5): cada tenant tiene su conjunto de módulos activos (`clients.modulos_activos`) con precio compuesto recalculado. Ante conflicto entre `docs/CLAUX-LEGACY.md` y este documento, prevalece este documento.

**Reenfoque junio 2026 — base contable + módulos à la carte (IMPLEMENTADO):** la base deja de ser un mini-ERP genérico y es un **sistema contable completo aunque simple** (ventas, gastos/cobros, cuentas por cobrar/pagar, tesorería, reportes financieros, terceros, multimoneda). En consecuencia: **Productos, Almacenes y Compras** pasan al **módulo Inventario**; **Multiempresa** pasa a ser **módulo de pago** (con el módulo OFF, 1 empresa por defecto); no hay módulo de contabilidad avanzada por ahora. Sin el módulo Inventario, las líneas de factura se escriben a mano; con él, se pueden elegir de los productos. La mecánica (catálogo `modulos_catalogo` + `clients.modulos_activos` + precio compuesto) está implementada y especificada en [docs/MODELO-MODULOS.md](MODELO-MODULOS.md).

**Sistema de módulos à la carte implementado (junio 2026) — migraciones 017 + 018 + 019:**
- **Planes eliminados (018):** tabla `plans` borrada; `clients.plan_id`/`payments.plan_id` vaciados (columnas inertes anulables, sin FK). Toda la UI/lógica de planes retirada (`/admin/planes`, `cambiarPlan`, `planes-constants.ts`).
- **Catálogo y gating (017):** `modulos_catalogo` (`tipo` base/modulo/funcionalidad, precios fundador/estándar) sembrado con 8 filas; gating del portal lee `clients.modulos_activos`; admin `/admin/modulos` (CRUD de precios) y toggle por cliente con recálculo (`setModulosCliente`). En el admin los módulos se activan con **switch en lista**; tarifa y ciclo son controles **segmentados** y se muestra el precio final **mensual y anual**.
- **Ciclo de facturación (018):** `clients.ciclo_facturacion` (mensual/anual; anual con descuento configurable). Conmutable por cliente respetando los plazos ya pagados. El importe del cobro sale de `precio_mensual_usd` + ciclo.
- **Estado de confirmación del pago (019):** `payments.estado` (`por_confirmar`|`confirmado`). Solo los **confirmados** cuentan como ingreso (dashboard y "total cobrado"). Acción `confirmarPago` + botón "Confirmar" en `/admin/pagos` y en el detalle del cliente; badge de estado y filtro.
- **Alta de cliente:** el trial es **opcional y está desmarcado por defecto** (los días de trial salen de Ajustes). Al crear un cliente de pago se **pre-crean dos cobros en estado `por_confirmar`**: el de configuración (`concepto=configuracion`, si importe > 0, pago único) y el primer cobro de suscripción (`concepto=suscripcion`, mensual/anual con el precio configurado, período = alta→expiración). El admin los confirma cuando entra el dinero. _Futuro: este flujo podrá automatizarse con cobro automático; de momento es manual._
- **Ajustes configurables (`settings`):** `pago_setup_usd_default`, `descuento_anual_pct`, `dias_trial_default`, editables en `/admin/configuracion` → sección Facturación.
- **Pagos:** registro manual (el cliente paga, verificamos y confirmamos); el cobro automático es futuro. El **monto a cobrar no es editable**: sale del precio configurado del cliente (`precio_mensual_usd` × ciclo, con prorrateo si hay solapamiento). _Gap conocido: no hay expiración automática (nada pasa a VENCIDO al caducar los días); el bloqueo del portal exige acción manual — pendiente para Fase 4._
- **Bypass de login para desarrollo local** (`src/lib/dev-auth.ts`): doble candado `NODE_ENV==='development'` + `DEV_BYPASS_AUTH=true`; inerte en producción (verificado con `next build`). Capa el admin (`src/proxy.ts`, layout admin) y, opcionalmente, el portal vía `DEV_PORTAL_CLIENT_ID` (`getPortalSession`). Documentado en README §Desarrollo local y `.env.example`.
- **Skills curadas a 13** (de 19; eliminadas las solapadas o ajenas al stack) y `AGENTS.md` reforzado: regla de UI destacada + tabla "qué leer según la tarea" para ahorrar tokens.
- **Arranque local:** los binarios nativos (Turbopack SWC, lightningcss, tailwind-oxide) venían en cuarentena de macOS; script `npm run fix-native` y `dev:webpack` como respaldo.
- **Páginas "en construcción":** los módulos del portal declarados sin implementar (compras, tesorería, inventario, contabilidad, rrhh, soporte) ya no dan 404; muestran un placeholder (`src/components/portal/EnConstruccion.tsx`) dentro del shell.

**Sesión de auditoría UI/UX + saneamiento (junio 2026):**
- **Contraste y tipografía (globals.css):** subida moderada de tipografía (sm 14→15px, xs 12→13px); arreglados los fallos WCAG (`--color-text-faint` 2:1, teal como texto 2.47:1 vía nuevo `--color-primary-text`) y subida general de contraste (muted, bordes, divisor, warning) en claro y oscuro. Verificado lint 0 errores + build.
- **Saneamiento sin cambiar lógica de módulos:** lint de 16 errores a 0; patrón de modal (mounted + Escape) centralizado en hooks `useMounted` (`useSyncExternalStore`, SSR-safe) y `useModalKeyboard` aplicados a 11 modales (elimina duplicación y avisos del React Compiler); constantes `MODULOS`/`DURACION_MODALIDAD` a `src/lib/planes-constants.ts`; bug corregido: `actualizarPlan` guardaba `plans.modulos` como CSV y rompía el gating al editar (ahora array); `MonedasView` sin setState en efecto; detalles de oferta/factura paralelizados (`Promise.all`); `Dialog.tsx` sin estilos inline.
- **Bypass dev mejorado:** `createClient()` usa `service_role` cuando el bypass está activo, para que el admin muestre datos reales al probar en local.
- **Bug de hover corregido:** los `<a>` con clase `.btn` heredaban el color de enlace en `:hover` (teal), dejando el texto del mismo color que el fondo (invisible) en Nueva factura/oferta y en Ver/Descargar PDF y Editar de los detalles. Las reglas globales de enlace ahora son `a:not(.btn)` y los `.btn-*:hover` fijan su color.
- **Colores fuera de paleta corregidos** en las pantallas que más desentonaban (ProductoDetalle, TerceroDetalle, ProductosView, AlmacenesView, EmpresasGrid, ActividadTabla): usaban slate `#64748b`/`#1e293b`, azul cielo `#0ea5e9`, bordes `#e2e8f0` y fondos `#fff` (que en dark quedaban blancos). Mapeados a tokens; los badges semánticos (estado/categoría/método de pago) se mantienen como variedad intencional.
- **Aclaración:** las supuestas "utilidades Tailwind en markup" (`flex-1`, `flex-shrink-0`, `grid-cols-2/3`) eran **falsos positivos**: están definidas como clases propias en `globals.css`, no son utilidades de Tailwind. No había nada que migrar ahí.
- **Badges hex → design system (ola 1 completada):** `TerceroDetalle` (`VIA_BADGE`/`TIPO_STYLE` → `.via-badge-*`/`.badge-*`), `AlmacenesView` (`TIPO_STYLE` → `.badge-*`), ventas (`AJUSTE_TIPO_STYLE` eliminado; colores de ajuste vía `.ven-ajuste-tag-{tipo}` y `.ven-ajuste-row-{tipo}`). Nuevos tokens `--color-purple*`, `--color-indigo*`, `--color-rose*` con variantes dark. Lint y TypeScript: 0 errores.
- **Ola 2 Tanda 1 completada:** `ProductoDetalle.tsx` (~75 inline styles) y `TerceroDetalle.tsx` (~57 inline styles) eliminados por completo. Nuevas clases compartidas en `globals.css`: `.det-card`, `.det-section-title`, `.det-label`, `.det-value(-pre/-break)`, `.det-page-header`, `.det-title-group`, `.det-page-title`, `.det-meta-row`, `.det-meta-inline`, `.det-actions`, `.det-field-grid(-sm)`, `.det-grid-4`, `.det-col-span-2`, `.det-tab-body`, `.det-empty(-icon/-title/-text)`, `.det-via-box(-header/-title)`, `.det-link-icon`, `.link-primary`, `.code-id`, `.code-label`, `.det-stock-num(-unit/-alert)`, `.detail-tabs`, `.detail-tab(.active)`, `.detail-tab-count`; `.prd-prices-table`, `.prd-moneda-badge`, `.prd-margen`; `.prd-stock-modal` y sub-clases; `.btn-info`; utilidades `.text-align-right`, `.text-faint`, `.mb-3/4/5`, `.mt-3/5`, `.ml-3`, `.overflow-x-auto`. TSC + lint: 0 errores nuevos.
- **Ola 2 Tandas 2–3 completadas:** `UsuariosView.tsx`, `EmpresasGrid.tsx`, `MonedasView.tsx`, `AlmacenesView.tsx`, `_ProductoFormModal.tsx`, `AccionesDetalle.tsx`, `ActividadTabla.tsx` saneados. Nuevas clases en `globals.css`: tamaños de modal (`.modal-sm/420/440/md/540/lg/xl`), `.modal-body-wide/form`, `MÓDULO ALMACENES` (`.alm-tipo-grid/btn`, `.alm-stats-grid/stat-card`, `.alm-id-text/desc-td/nota-info`), `MÓDULO ACTIVIDAD` (`.act-toolbar/pill`, `.act-entity-badge/badge-*`, `.act-*-cell`), MÓDULO PRODUCTOS editor (`.prd-editor-*`, `.prd-tipo-*`), utilidades (`.input-display`, `.input-static`, `.btn-ghost-xs`, `.loading-row`, `.spinner-xs`, `.info-box`, `.pro-rata-details`). Arreglado conflicto `.modal-sm/lg` en TERCEROS (ahora `.modal-xl` = 800 px). Archivos huérfanos macOS eliminados. TSC + lint: 0 errores.
- **Ola 2 Tandas 4–5 completadas (inline styles eliminados):** todos los `style={{…}}` con valores fijos han sido reemplazados por clases del design system. Nuevas clases/utilidades en `globals.css`: `MÓDULO VENTAS` (`.ven-nueva-*`, `.ven-form-*`, `.ven-breadcrumb-link`, `.ven-section-actions`, `.ven-td-amt`, `.modal-1000`), `MÓDULO FACTURACIÓN` (`.fac-plan-title-row`, `.text-sm-nowrap`, `.text-sm-muted`), utilidades (`.mt-1/2/3/4/5`, `.mb-0/4/5`, `.label-hint`, `.label-hint-xs`, `.label-secondary`, `.label-muted-hint`, `.input-group-narrow`, `.login-forgot-link`, `.link-full-center`, `.login-footer`, `.flex-shrink-0`, `.input-pwd-wrap`, `.input-pwd`, `.input-eye-btn`, `.input-file`). Solo permanecen `style={{}}` legítimos (colores de BD por tenant, ternarios sobre tokens, lookups de variables JS). Sin deuda de inline styles fijos en ningún `.tsx` del proyecto.

## 3. Principios de arquitectura no negociables

1. **Multi-tenant con módulos conmutables (feature flags).** Un solo código y una sola infraestructura. Cada negocio es configuración: datos propios, módulos activos, plan, canales. Activar un módulo para un tenant no debe requerir despliegue. La navegación y el onboarding muestran solo lo contratado.
2. **Una sola fuente de verdad por dato.** El menú es el ejemplo canónico: el mismo registro alimenta el menú QR público, el conocimiento del bot y la disponibilidad ligada a inventario. Cambiar un precio o marcar "agotado" en el panel del dueño se refleja en todos los consumidores del dato.
3. **Rendimiento como requisito funcional.** Todo lo público (landing, diagnóstico, menús QR, mini-webs) debe ser estático o pre-renderizado, servido por CDN, mobile-first y utilizable en 3G. Presupuesto orientativo: carga inicial de páginas públicas < 100 KB, sin frameworks pesados en el lado público. PWA con service worker: un menú ya visitado debe funcionar sin conexión.
4. **Backend fuera de Cuba.** Hosting en España/EEUU. Todas las llamadas a APIs de IA salen del servidor, nunca del cliente. Proveedor de IA principal: DeepSeek (coste bajo, sin exposición a sanciones de EEUU). Diseñar el cliente de IA como adaptador intercambiable de proveedor.
5. **Telegram-first y agnóstico de canal.** La API oficial de WhatsApp Business bloquea los números +53: no construir nada sobre ella. El bot se implementa sobre la Bot API de Telegram (cada negocio tiene su propio bot/token vía BotFather; todos los tokens apuntan al mismo webhook, que enruta por token). La lógica de negocio del bot (reservas, menú, horarios) vive separada del conector de canal, de modo que añadir chat web embebido o un futuro WhatsApp sea solo añadir un conector.
6. **Motor de bot híbrido.** Las consultas predecibles (horarios, precios, platos, ubicación) se resuelven por lógica de código contra los datos del tenant: respuesta instantánea, coste cero. La IA solo interviene en conversación libre. El bot base funciona completo por botones/teclados inline sin IA: la IA es una capa opcional (add-on de pago).
7. **Límites y medición de IA por tenant.** Registrar tokens/conversaciones por negocio y mes. El add-on tiene cupo (~500 conversaciones/mes); al acercarse, avisar internamente, nunca cortar en mitad de una conversación.
8. **Corte por impago con gracia.** El estado de pago de un tenant se gestiona manualmente desde el admin interno. La desactivación nunca es brusca: aviso → degradación → corte, con plazos configurables. Jamás apagar un menú QR en mitad de un servicio.
9. **El diagnóstico es lógica pura.** El formulario de captación es de selección (sin texto libre) y el informe se genera por reglas en código, sin IA: determinista, instantáneo, gratis.

## 4. Piezas de la plataforma

- **Público (embudo):** landing de CLAUX + formulario de diagnóstico + informe de resultados con CTA a reunión. Ultraligero.
- **Público (por negocio):** catálogo digital QR (menú en restaurantes; multi-idioma opcional) + mini-web (ubicación, horarios, fotos, link a reservas) + formulario de reservas + (premium) chat embebido con IA.
- **Panel del dueño (PWA):** edición de menú y datos del negocio, gestión de reservas (confirmar/rechazar, capacidad por franjas, no-shows), y los módulos de gestión según plan (contabilidad, inventario, RRHH, analítica…). Notificaciones al Telegram personal del dueño (reserva nueva, resumen semanal).
- **Bot de Telegram por negocio:** versión botones (base) y versión conversacional con IA (add-on).
- **Admin interno (solo equipo CLAUX):** clientes, módulos activos por cliente con toggle, plan, precio resultante (cada módulo tiene precio unitario interno; el toggle recalcula la mensualidad), estado y vencimiento de pago, consumo de IA por tenant, y gestión del periodo de gracia. Versión 1 deliberadamente mínima.

## 5. Catálogo de módulos y modelo comercial

El modelo comercial NO son planes cerrados: es **una base mensual + módulos à la carte** que suman al precio. Cada cliente tiene la base más el conjunto de módulos/funcionalidades activos; el admin interno gestiona el toggle y el precio resultante se recalcula automáticamente. Lo no contratado se muestra en el portal visible pero bloqueado, con CTA de activación (patrón ya implementado en el sidebar). Tres tipos de pieza con **una sola mecánica de on/off**: la **base** (obligatoria, el sistema contable), los **módulos** (capacidades generales) y las **funcionalidades por sector** (propias de un tipo de negocio concreto).

**Base contable (obligatoria) — $20 / $35 al mes.** Es el núcleo de CLAUX: un sistema contable completo aunque simple. Incluye:
- **Ventas:** ingresos, ofertas/presupuestos y facturas (numeración correlativa, multimoneda, PDF).
- **Gastos y cobros.**
- **Cuentas por cobrar** y **cuentas por pagar.**
- **Tesorería:** cajas/cuentas, movimientos y saldos multimoneda.
- **Reportes financieros:** estado de resultados y flujo de caja simples.
- **Terceros** (clientes y proveedores) y **multimoneda** con pares de tasa.
- Panel del negocio y soporte.

No incluye partida doble ni plan de cuentas oficial: si en el futuro hace falta, será un **tier contable avanzado** con funcionalidades nuevas, no parte de la base.

| Módulo (capacidad general) | Contenido | Precio fundador / estándar |
|---|---|---|
| Inventario | Almacenes, productos, compras, movimientos, disponibilidad conectada al catálogo | +$8 / +$14 |
| RRHH | Personal, contratos, bajas, turnos, nómina simple | +$8 / +$14 |
| Multiempresa | Varias empresas/locales con consolidación (lógica ya implementada; pasa a ser de pago) | +$12 / +$20 |
| Asistente IA | Chat con clientes (Telegram + embebido en catálogo), reservas/pedidos en lenguaje natural, consultas del dueño sobre sus módulos activos, resumen semanal | +$15 / +$25 |

| Funcionalidad por sector | Contenido | Precio fundador / estándar |
|---|---|---|
| Catálogo digital QR + mini-web | Carta/catálogo/servicios con fotos y precios por QR y enlace; mini-web pública; multi-idioma opcional | +$10 / +$18 |
| Reservas y citas + bot Telegram | Formulario público, panel (confirmar/rechazar, capacidad o agenda por franjas, no-shows), bot de botones, notificaciones al dueño | +$10 / +$18 |
| Documentos de imprenta | El cliente envía sus documentos por correo antes de pasar a recogerlos | a definir |

Módulos/funcionalidades de fases futuras (no MVP): **contabilidad avanzada** (plan de cuentas, partida doble / modo contable oficial cubano, rol contador externo), **marketing y reseñas** (Google Business, promos), operación en sala offline-first sobre red local (comandas, pantalla de cocina) y equivalentes por vertical, gestión de repartidores, fidelización, CRM, activos fijos. Variantes "Google" como integraciones opcionales (Calendar, Sheets, Business Profile).

Implicación técnica (implementada): el modelo de "planes" cerrados se eliminó; la entidad que manda es el conjunto de módulos activos del tenant (`clients.modulos_activos`) y su precio compuesto, más su ciclo (`ciclo_facturacion`), no un tier con nombre. Los precios viven en datos gestionados desde el admin (tabla `modulos_catalogo`); nunca hardcodear precios en el producto. Detalle técnico de la mecánica en [docs/MODELO-MODULOS.md](MODELO-MODULOS.md).

## 6. Modelo de datos mínimo (orientativo)

- **Negocio (tenant):** identidad, datos públicos (nombre, dirección, geoloc, horarios, fotos, idiomas), plan, módulos activos, estado de pago, configuración del bot (token Telegram, tono), límites de IA.
- **Menú:** categorías y platos con nombre, precio, foto, descripción, **ingredientes, alérgenos y calorías** (campos necesarios para el add-on de IA; se capturan en el onboarding llave en mano), disponibilidad (agotado), traducciones.
- **Reservas:** fecha/franja, personas, datos de contacto, canal de origen (web/bot), estado (pendiente/confirmada/rechazada/no-show), capacidad por franja del negocio.
- **Base contable:** ventas (facturas/ofertas), terceros y monedas ya existen y se reutilizan. Pendientes de construir: gastos/cobros, cuentas por cobrar/pagar, tesorería y reportes financieros (reutilizando los patrones de ventas: numeración correlativa, estados, multimoneda).
- **Inventario / RRHH:** Productos y Almacenes (ya construidos) pertenecen al **módulo inventario**, no a la base. Las líneas de factura de la base se introducen a mano; el módulo inventario añade el selector de productos sobre el mismo editor (`_DocumentoLineasEditor` ya soporta ambos modos vía `datalist`). RRHH es módulo aparte (personal, contratos, bajas, turnos, nómina simple).
- **Uso de IA:** registro por tenant, mes, conversaciones y tokens.

## 7. Restricciones de contexto (Cuba) que condicionan decisiones técnicas

Conectividad móvil lenta y cara (ETECSA), cortes eléctricos frecuentes, usuarios 95% en móvil, pagos del cliente final gestionados fuera de la plataforma (cobro manual en USD/EUR vía cuentas en EEUU/España — la plataforma NO procesa pagos, solo refleja el estado), WhatsApp Business API inutilizable para +53, Telegram de adopción masiva. El idioma de toda la interfaz es español (menús públicos además en inglés para turismo). Cualquier decisión que aumente peso de página, dependencia de conexión continua o latencia percibida debe justificarse.

## 8. Prioridades de construcción (Fase 0 — MVP comercializable)

La auditoría (sección 2), el cascarón multi-tenant y el admin interno ya existen. El **sistema real de módulos à la carte ya está implementado** (migraciones 017 + 018; planes eliminados). El eje pendiente de la primera ola es **convertir la base en un sistema contable completo**; la capa pública vertical de restaurantes viene después. Orden:

1. Deuda técnica previa: migrar hash de contraseñas a scrypt/argon2 y volcar el esquema base de la BD al repo.
2. ~~**Sistema de módulos à la carte**~~ **(HECHO)**: catálogo `modulos_catalogo` (`tipo` base/módulo/funcionalidad), columnas `clients.modulos_activos`/`tarifa`/`ciclo_facturacion`/`precio_mensual_usd`, gating del portal leído del cliente, admin con toggle por módulo y recálculo de precio (`/admin/modulos` + tarjeta en detalle de cliente), ciclo mensual/anual con descuento, pago único de configuración, y planes eliminados. Detalle técnico en [docs/MODELO-MODULOS.md](MODELO-MODULOS.md).
3. **Completar la base contable (siguiente):** Tesorería, Gastos/Cobros, Cuentas por cobrar, Cuentas por pagar y Reportes financieros, reutilizando los patrones de Ventas. Gate del selector de productos en las líneas de factura por el módulo Inventario.
4. Modelo de datos del vertical: extender el tenant con datos públicos del negocio (sección 6) y crear catálogo (categorías/platos con ingredientes, alérgenos, calorías, foto, agotado, traducciones) y reservas.
5. Catálogo QR + mini-web pública (rutas públicas estáticas/ISR, presupuesto de rendimiento de la sección 3) + edición en el portal del dueño.
6. Reservas: formulario público + panel en el portal + notificación Telegram al dueño.
7. Bot de Telegram de botones (reservar, catálogo, horarios, ubicación) con enrutado multi-tenant por token.
8. Landing de CLAUX + formulario de diagnóstico + informe (embudo).
9. Build-out de los módulos restantes (Inventario: compras/movimientos; RRHH) y add-on IA v1 (motor híbrido + DeepSeek + límites por tenant).

Regla general: ante la duda entre hacerlo perfecto o hacerlo vendible, vendible — pero nunca a costa de los principios de la sección 3, que son los que evitan rehacer la casa después.

# CLAUX — Contexto del proyecto para desarrollo
> Fuente de verdad del producto y la arquitectura. Vive en docs/ y se lee completo antes de cualquier tarea (ver AGENTS.md). Derivado del plan de negocio de junio 2026 (v2).

## 1. Qué es CLAUX

Plataforma SaaS todo en uno para digitalizar negocios locales cubanos. El vertical de lanzamiento son los restaurantes, pero la plataforma es multi-sector por configuración (gimnasios, salones de belleza, tiendas, servicios): el núcleo es el mismo y cambian la terminología y los módulos típicos, vía plantillas de onboarding por sector. Por eso la nomenclatura interna de los módulos públicos es genérica: **"catálogo digital QR"** (que en restaurantes se renderiza como "menú") y **"reservas y citas"** (mesas, citas por profesional o clases según el sector). Una sola aplicación multi-tenant: cada negocio (tenant) ve y configura únicamente los módulos que tiene activos. El cliente accede casi siempre desde móvil con conexión lenta. La IA es el eje de la comunicación comercial del producto; internamente se usa solo donde aporta (ver principios 6 y 9). El equipo opera desde España y Cuba; el hosting y los servicios externos se contratan desde España/EEUU.

## 2. Punto de partida del código — AUDITADO (junio 2026)

El desarrollo NO parte de cero. El repositorio existente (`DamianMartinMayedo/claux`) fue auditado y su estado es el siguiente:

**Stack confirmado:** Next.js 16.2.4 (App Router, TypeScript, Server Actions, middleware en `src/proxy.ts`), React 19, Supabase (PostgreSQL), Tailwind v4 solo como reset — el estilo real es el design system propio de CSS custom properties (parciales por orden de cascada en `src/app/styles/`, orquestados por `globals.css`; valores en `docs/CLAUX-LEGACY.md` §8; teal + ámbar, Cabinet Grotesk + Satoshi, light/dark). Despliegue previsto en Vercel. `html2pdf.js` para PDFs. Este stack se mantiene.

**Lo que YA existe y se reutiliza:**
- **Multi-tenancy real** por `client_id` en todas las tablas. Doble autenticación: super admin con Supabase Auth (`/admin`) y usuarios de cliente con tabla `client_users` + JWT HMAC propio en cookie httpOnly (`/portal`). Roles: `admin_empresa`, `usuario`, `solo_lectura`.
- **Feature flags operativos**: los módulos activos del cliente (`clients.modulos_activos`) determinan qué módulos se ven; el sidebar del portal candado los no contratados (visibles pero bloqueados, con upgrade como CTA).
- **Admin interno completo** (`/admin`): clientes con estados ACTIVO/TRIAL/GRACIA/VENCIDO/SUSPENDIDO, periodo de gracia con motivo y fecha, catálogo de módulos con precios en USD (`/admin/modulos`), toggle de módulos por cliente con recálculo automático del precio, registro de pagos (suscripción y pago único de configuración) con reactivación automática, dashboard de vencimientos, log de auditoría y pantalla de bloqueo con degradación (`BloqueadoScreen`).
- **Portal cliente (ERP de gestión)**: multi-empresa, multi-moneda con pares de tasa (CUP/MLC/USD/EUR), terceros, productos con categorías, almacenes, ventas (facturas y ofertas con numeración correlativa tipo `FAC-2026-0001`, estados BORRADOR/CONFIRMADO/ANULADO, anulación sin borrado físico, PDF) y gestión de usuarios.

**Base contable en construcción (Fase 4):** ya implementadas — **Tesorería** (cuentas caja/banco/pasarela, movimientos ingreso/egreso, transferencias misma-moneda, saldos por moneda — `cuentas` + `movimientos_tesoreria`), **Gastos y cobros** (registro simple no facturado — `gastos_cobros`) y **Cuentas por cobrar/pagar** (CxC = facturas EMITIDA pendientes + cobros pendientes; CxP = gastos pendientes; vistas de aging por antigüedad en `cobranza.ts` + `CuentasView`; el cobro de facturas también vive en el detalle de factura). **Liquidación unificada:** pagar/cobrar cualquier documento (factura o registro) es un movimiento de Tesorería con `origen=PAGO/COBRO` y `referencia_id`; admite pagos **parciales**; `monto_liquidado`/saldo y el estado (PENDIENTE/PARCIAL/LIQUIDADO; factura → COBRADA al saldar) se **derivan**, sin tabla de liquidaciones. Pendiente: **reportes financieros** (placeholder en navegación) — en la **base contable** (ver §5). Compras y movimientos quedan en el **módulo inventario** (que ya tiene almacenes y productos); RRHH y asistente IA son módulos. El placeholder "contabilidad" (`modulo_contable`) se retira del MVP: la base ya cubre la contabilidad simple completa y un tier contable avanzado (partida doble / plan de cuentas oficial) es trabajo futuro.

**Independencia de módulos (regla transversal):** cada módulo funciona solo; la base opera al 100% sin ninguno. La interacción es aditiva en una dirección: si el cliente tiene un módulo, aparecen conveniencias de llenado rápido en otros módulos que lo aprovechan (ej.: el selector de productos en las líneas de documentos solo se carga si `inventario` está activo — sin él, texto libre). Nunca a la inversa. Helper: `src/lib/modulos.ts` (`tieneModulo`).

**Lo que NO existe y constituye el trabajo de Fase 0** (la raíz redirige hoy a `/admin/login`): toda la capa pública — landing + formulario de diagnóstico + informe (embudo), menú digital QR + mini-web por negocio, sistema de reservas con panel, bot de Telegram y capa de IA. Las páginas públicas se construyen estáticas/pre-renderizadas (SSG/ISR de Next) fuera del portal: deben cumplir el presupuesto de rendimiento de la sección 3 y NO cargar el peso del ERP. Requerirán además una vía de lectura pública de datos (políticas RLS de solo lectura para menú/mini-web o generación estática), ya que hoy todo el acceso es vía `service_role` en servidor.

**Deuda técnica a corregir pronto:** (1) el hash de contraseñas de `client_users` es SHA-256+salt — migrar a scrypt o argon2 antes de tener clientes reales; (2) las migraciones de `supabase/migrations` empiezan en 001 sobre tablas creadas a mano en el SQL Editor — volcar el esquema base completo al repo para que la base de datos sea reconstruible; (3) la seguridad entre tenants depende de filtrar por `client_id` en cada query (no hay políticas RLS por tenant): toda query nueva debe revisarse contra esta regla.

**Nomenclatura:** las menciones a "planes" (Básico/Profesional/Empresarial) en `docs/CLAUX-LEGACY.md` son obsoletas (ese modelo se eliminó); ante conflicto con este documento, prevalece este.

**Modelo comercial y facturación (implementado; detalle en §5 y [MODELO-MODULOS.md](MODELO-MODULOS.md)):**
- **Base contable + módulos à la carte.** No hay "planes": el precio = `base + Σ módulos activos` por tarifa (fundador/estándar) desde `modulos_catalogo`; el gating del portal lee `clients.modulos_activos`. La base es el sistema contable completo; **Productos/Almacenes/Compras → módulo Inventario**, **Multiempresa = módulo de pago** (OFF → 1 empresa). Sin contabilidad avanzada (partida doble) — tier futuro. Admin: catálogo en `/admin/modulos` + toggle por cliente (switch en lista, tarifa y ciclo segmentados, precio mensual y anual).
- **Ciclo** por cliente (`ciclo_facturacion` mensual/anual; anual con `descuento_anual_pct`). Importe del cobro = `precio_mensual_usd × ciclo`; en el registro de pago **no es editable**.
- **Pagos con estado** (`payments.estado` por_confirmar/confirmado): solo los confirmados cuentan como ingreso. Al crear un cliente de pago se **pre-crean** el cobro de configuración (pago único) y el primer cobro de suscripción en `por_confirmar`; se confirman al entrar el dinero (`confirmarPago`). Trial **opcional, off por defecto**. Ajustes en `settings` (`pago_setup_usd_default`, `descuento_anual_pct`, `dias_trial_default`) editables en `/admin/configuracion`.
- **Bloqueo por pago (estado `DESACTIVADO`, antes SUSPENDIDO):** un cliente de pago nace **DESACTIVADO** y solo se activa al **confirmar** el primer cobro de suscripción (`confirmarPago`) o al aplicar **período de gracia**. No hay "reactivar" manual. El portal bloquea por estado DESACTIVADO/VENCIDO o por `fecha_expiracion` pasada sin gracia vigente. `desactivarClientesVencidos()` (corre al cargar el layout admin) pasa a DESACTIVADO los caducados por fecha o con gracia vencida. Cambios admin→portal se reflejan **en vivo** vía Supabase Realtime (`PortalRealtimeSync`).
- **Gaps conocidos (Fase 4):** sin acción de "cancelar suscripción"; expiración automática sólo al abrir el admin (no hay cron); transferencias de tesorería solo entre cuentas de la misma moneda (cambio de divisa con tasa, pendiente); gastos/cobros, CxC/CxP y reportes pendientes.

**Dev:** bypass de login local en `src/lib/dev-auth.ts` (`NODE_ENV==='development'` + `DEV_BYPASS_AUTH=true`, inerte en prod; `createClient()` usa `service_role` con el bypass activo); portal impersonable vía `DEV_PORTAL_CLIENT_ID`. Binarios nativos macOS en cuarentena → `npm run fix-native`.

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
3. **Completar la base contable (en curso, por tandas):** ~~gate del selector de productos por módulo Inventario~~ **(HECHO)** · ~~Tesorería~~ **(HECHO)** · ~~Gastos y cobros~~ **(HECHO)** · ~~CxC/CxP + cobro de facturas~~ **(HECHO)** (aging por antigüedad; liquidación unificada parcial vía Tesorería) · **siguiente:** Reportes financieros (estado de resultados + flujo de caja simples) reutilizando los datos de ventas, gastos/cobros y movimientos de tesorería.
4. Modelo de datos del vertical: extender el tenant con datos públicos del negocio (sección 6) y crear catálogo (categorías/platos con ingredientes, alérgenos, calorías, foto, agotado, traducciones) y reservas.
5. Catálogo QR + mini-web pública (rutas públicas estáticas/ISR, presupuesto de rendimiento de la sección 3) + edición en el portal del dueño.
6. Reservas: formulario público + panel en el portal + notificación Telegram al dueño.
7. Bot de Telegram de botones (reservar, catálogo, horarios, ubicación) con enrutado multi-tenant por token.
8. Landing de CLAUX + formulario de diagnóstico + informe (embudo).
9. Build-out de los módulos restantes (Inventario: compras/movimientos; RRHH) y add-on IA v1 (motor híbrido + DeepSeek + límites por tenant).

Regla general: ante la duda entre hacerlo perfecto o hacerlo vendible, vendible — pero nunca a costa de los principios de la sección 3, que son los que evitan rehacer la casa después.

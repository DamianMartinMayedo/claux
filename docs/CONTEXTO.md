# CLAUX — Contexto del proyecto para desarrollo
> Fuente de verdad del producto y la arquitectura. Vive en docs/ y se lee completo antes de cualquier tarea (ver AGENTS.md).

## 1. Qué es CLAUX

Plataforma SaaS todo en uno para digitalizar negocios locales cubanos, principalmente restaurantes. Una sola aplicación multi-tenant: cada negocio (tenant) ve y configura únicamente los módulos activos en su plan. El cliente objetivo no tiene ninguna herramienta previa (menú en papel, reservas por teléfono, cuentas en libreta) y accede casi siempre desde móvil con conexión lenta. El equipo opera desde España y Cuba; el hosting y los servicios externos se contratan desde España/EEUU.

## 2. Punto de partida del código — AUDITADO (junio 2026)

El desarrollo NO parte de cero. El repositorio existente (`DamianMartinMayedo/claux`) fue auditado y su estado es el siguiente:

**Stack confirmado:** Next.js 16.2.4 (App Router, TypeScript, Server Actions, middleware en `src/proxy.ts`), React 19, Supabase (PostgreSQL), Tailwind v4 solo como reset — el estilo real es el design system propio de CSS custom properties documentado en `docs/CLAUX-LEGACY.md` (teal + ámbar, Cabinet Grotesk + Satoshi, light/dark). Despliegue previsto en Vercel. `html2pdf.js` para PDFs de facturas. Este stack se mantiene.

**Lo que YA existe y se reutiliza:**
- **Multi-tenancy real** por `client_id` en todas las tablas. Doble autenticación: super admin con Supabase Auth (`/admin`) y usuarios de cliente con tabla `client_users` + JWT HMAC propio en cookie httpOnly (`/portal`). Roles: `admin_empresa`, `usuario`, `solo_lectura`.
- **Feature flags operativos**: los planes (`plans.modulos`) determinan los módulos activos; el sidebar del portal candado los no contratados (visibles pero bloqueados, con upgrade como CTA).
- **Admin interno completo** (`/admin`): clientes con estados ACTIVO/TRIAL/GRACIA/VENCIDO/SUSPENDIDO, periodo de gracia con motivo y fecha, planes con CRUD y precios en USD, registro de pagos con reactivación automática, dashboard de vencimientos, log de auditoría y pantalla de bloqueo con degradación (`BloqueadoScreen`).
- **Portal cliente (ERP de gestión)**: multi-empresa, multi-moneda con pares de tasa (CUP/MLC/USD/EUR), terceros, productos con categorías, almacenes, ventas (facturas y ofertas con numeración correlativa tipo `FAC-2026-0001`, estados BORRADOR/CONFIRMADO/ANULADO, anulación sin borrado físico, PDF) y gestión de usuarios.

**Declarado pero sin implementar** (en navegación con gating, sin páginas): compras, tesorería, inventario (hay almacenes pero no movimientos), contabilidad, RRHH.

**Lo que NO existe y constituye el trabajo de Fase 0** (la raíz redirige hoy a `/admin/login`): toda la capa pública — landing + formulario de diagnóstico + informe (embudo), menú digital QR + mini-web por negocio, sistema de reservas con panel, bot de Telegram y capa de IA. Las páginas públicas se construyen estáticas/pre-renderizadas (SSG/ISR de Next) fuera del portal: deben cumplir el presupuesto de rendimiento de la sección 3 y NO cargar el peso del ERP. Requerirán además una vía de lectura pública de datos (políticas RLS de solo lectura para menú/mini-web o generación estática), ya que hoy todo el acceso es vía `service_role` en servidor.

**Deuda técnica a corregir pronto:** (1) el hash de contraseñas de `client_users` es SHA-256+salt — migrar a scrypt o argon2 antes de tener clientes reales; (2) las migraciones de `supabase/migrations` empiezan en 001 sobre tablas creadas a mano en el SQL Editor — volcar el esquema base completo al repo para que la base de datos sea reconstruible; (3) la seguridad entre tenants depende de filtrar por `client_id` en cada query (no hay políticas RLS por tenant): toda query nueva debe revisarse contra esta regla.

**Nota de nomenclatura:** el código y `docs/CLAUX-LEGACY.md` usan planes Básico/Profesional/Empresarial (herencia del enfoque mini-ERP genérico). El modelo comercial vigente es Básico/Intermedio/Avanzado + add-on IA (sección 5), con verticalización en restaurantes. Los planes son datos, no código, así que el cambio es de contenido; ante conflicto entre `docs/CLAUX-LEGACY.md` y este documento, prevalece este documento.

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
- **Público (por negocio):** menú QR multi-idioma (ES/EN) + mini-web (ubicación, horarios, fotos, link a reservas) + formulario de reservas + (premium) chat embebido con IA.
- **Panel del dueño (PWA):** edición de menú y datos del negocio, gestión de reservas (confirmar/rechazar, capacidad por franjas, no-shows), y los módulos de gestión según plan (contabilidad, inventario, RRHH, analítica…). Notificaciones al Telegram personal del dueño (reserva nueva, resumen semanal).
- **Bot de Telegram por negocio:** versión botones (base) y versión conversacional con IA (add-on).
- **Admin interno (solo equipo CLAUX):** clientes, módulos activos por cliente con toggle, plan, precio resultante (cada módulo tiene precio unitario interno; el toggle recalcula la mensualidad), estado y vencimiento de pago, consumo de IA por tenant, y gestión del periodo de gracia. Versión 1 deliberadamente mínima.

## 5. Catálogo de módulos y planes

| Plan | Módulos |
|---|---|
| Básico — "Presencia y reservas" | Menú QR multi-idioma · mini-web · reservas (formulario + panel + notificaciones) · bot Telegram de botones · soporte |
| Intermedio — "Gestión" | Básico + contabilidad básica (ingresos/gastos, cierres de caja) · inventario con disponibilidad en carta · RRHH básico |
| Avanzado — "Negocio completo" | Intermedio + multi-local con datos consolidados · analítica · roles de usuario para empleados · marketing/reseñas · pedidos a domicilio |
| Add-on IA (sobre cualquier plan) | Chat conversacional (Telegram + embebido en menú) · dudas de carta (ingredientes, alérgenos, calorías, recomendaciones) · reservas y pedidos en lenguaje natural · en Intermedio+: consultas del dueño sobre su negocio · en Avanzado: sobre todos sus locales · resumen semanal por IA |

Módulos de fases futuras (no MVP): operación en sala offline-first sobre red local del negocio (comandas, pantalla de cocina), gestión de repartidores, fidelización, CRM ampliado. Variantes "Google" como integraciones opcionales: sincronización de reservas con Google Calendar, exportación de finanzas a Sheets, optimización de perfil de Google Business.

Precios de referencia (fundador / estándar): Básico $20/$35, Intermedio $45/$75, Avanzado $80/$130, IA +$15/+$25, setup $100-200/$200-400. Configurables desde el admin; nunca hardcodear precios en el producto.

## 6. Modelo de datos mínimo (orientativo)

- **Negocio (tenant):** identidad, datos públicos (nombre, dirección, geoloc, horarios, fotos, idiomas), plan, módulos activos, estado de pago, configuración del bot (token Telegram, tono), límites de IA.
- **Menú:** categorías y platos con nombre, precio, foto, descripción, **ingredientes, alérgenos y calorías** (campos necesarios para el add-on de IA; se capturan en el onboarding llave en mano), disponibilidad (agotado), traducciones.
- **Reservas:** fecha/franja, personas, datos de contacto, canal de origen (web/bot), estado (pendiente/confirmada/rechazada/no-show), capacidad por franja del negocio.
- **Contabilidad / inventario / RRHH:** auditar y reutilizar el modelo de la base de código existente; adaptarlo a multi-tenant si no lo es.
- **Uso de IA:** registro por tenant, mes, conversaciones y tokens.

## 7. Restricciones de contexto (Cuba) que condicionan decisiones técnicas

Conectividad móvil lenta y cara (ETECSA), cortes eléctricos frecuentes, usuarios 95% en móvil, pagos del cliente final gestionados fuera de la plataforma (cobro manual en USD/EUR vía cuentas en EEUU/España — la plataforma NO procesa pagos, solo refleja el estado), WhatsApp Business API inutilizable para +53, Telegram de adopción masiva. El idioma de toda la interfaz es español (menús públicos además en inglés para turismo). Cualquier decisión que aumente peso de página, dependencia de conexión continua o latencia percibida debe justificarse.

## 8. Prioridades de construcción (Fase 0 — MVP comercializable)

La auditoría (sección 2), el cascarón multi-tenant y el admin interno ya existen. El trabajo de Fase 0 es la capa pública vertical de restaurantes, en este orden:

1. Deuda técnica previa: migrar hash de contraseñas a scrypt/argon2 y volcar el esquema base de la BD al repo.
2. Modelo de datos del vertical: extender el tenant con datos públicos del negocio (sección 6) y crear menú (categorías/platos con ingredientes, alérgenos, calorías, foto, agotado, traducciones) y reservas.
3. Menú QR + mini-web pública (rutas públicas estáticas/ISR, presupuesto de rendimiento de la sección 3) + edición del menú en el portal del dueño.
4. Reservas: formulario público + panel en el portal + notificación Telegram al dueño.
5. Bot de Telegram de botones (reservar, menú, horarios, ubicación) con enrutado multi-tenant por token.
6. Landing de CLAUX + formulario de diagnóstico + informe (embudo).
7. Reconfiguración de planes (datos) al modelo Básico/Intermedio/Avanzado + add-on IA, y exposición de los nuevos módulos en el gating existente.
8. Cierre del módulo de gestión mínimo para el plan Intermedio (registro de ingresos/gastos y cierres de caja sobre la base de ventas/tesorería ya prevista; inventario con disponibilidad en carta conectado al menú).
9. Add-on IA v1 (motor híbrido + DeepSeek + límites por tenant).

Regla general: ante la duda entre hacerlo perfecto o hacerlo vendible, vendible — pero nunca a costa de los principios de la sección 3, que son los que evitan rehacer la casa después.

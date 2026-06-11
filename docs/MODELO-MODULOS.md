# CLAUX — Modelo comercial v2: base contable + módulos à la carte

> Spec de diseño e implementación del modelo comercial. Complementa `docs/CONTEXTO.md` §5 (que define el
> **qué** del negocio); aquí está el **cómo** técnico. Ante conflicto manda CONTEXTO.md.
>
> **Estado:** DISEÑADO, NO IMPLEMENTADO. La migración de abajo está lista pero **no se ha aplicado** a la
> Supabase compartida. Nada de este documento toca todavía el código de producción. Ver §8 "Qué falta".

---

## 1. El problema en una frase

Hoy el código modela **planes cerrados con nombre** (tabla `plans`: Básico/Profesional/Empresarial, con un
precio único por plan). El modelo comercial v2 (CONTEXTO §5) es otra cosa: **una base obligatoria + módulos
sueltos que el cliente activa a la carta**, y el precio mensual de cada cliente es la **suma** de su base
más los módulos que tenga encendidos. Hay que alinear los datos y el admin con eso.

## 2. Lo que YA hay (auditoría, verificado en código junio 2026)

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

## 3. Arquitectura elegida: catálogo de módulos + módulos por cliente

Decisión del propietario (frente a "reutilizar la tabla plans"): es la única que cumple CONTEXTO §5 al
100% (precio compuesto real, precio fundador/estándar por módulo, toggle por módulo con recálculo).

**La idea, simple:**
1. Un **catálogo** de módulos disponibles, con su precio (tabla `modulos_catalogo`). Es una lista de
   "productos" que CLAUX vende. Los precios viven aquí, en datos — **nunca** en el código.
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
│ orden            (int)  20               │           │ plan_id          (se conserva)  │
│ activo           (bool) true             │           └─────────────────────────────────┘
└─────────────────────────────────────────┘
```

`plan_id` **se conserva** (no se borra): el histórico de `payments` lo referencia. Simplemente deja de ser
la fuente del gating.

## 4. Migración SQL — PENDIENTE DE APLICAR

> ⚠️ **No la apliques hasta la fase de implementación** (§8). Cuando llegue el momento, se promueve a
> `supabase/migrations/017_modulos_catalogo.sql` y se aplica con `supabase db push` o desde el SQL Editor.
> Ajusta los precios al catálogo real de CONTEXTO §5 antes de correrla.

```sql
-- ── 017: Catálogo de módulos + módulos por cliente (modelo à la carte) ──────────

-- 1. Catálogo de módulos vendibles
CREATE TABLE IF NOT EXISTS modulos_catalogo (
  clave                text PRIMARY KEY,           -- p.ej. 'catalogo_qr'
  nombre               text NOT NULL,
  descripcion          text,
  precio_fundador_usd  numeric(10,2) NOT NULL DEFAULT 0,
  precio_estandar_usd  numeric(10,2) NOT NULL DEFAULT 0,
  es_base              boolean NOT NULL DEFAULT false,  -- la base obligatoria
  orden                int NOT NULL DEFAULT 0,
  activo               boolean NOT NULL DEFAULT true
);

-- 2. Módulos activos y precio compuesto por cliente
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS modulos_activos    text[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tarifa             text          NOT NULL DEFAULT 'estandar',  -- 'fundador'|'estandar'
  ADD COLUMN IF NOT EXISTS precio_mensual_usd numeric(10,2) NOT NULL DEFAULT 0;

-- 3. Seed del catálogo (precios fundador / estándar de CONTEXTO §5 — AJUSTAR si cambian)
INSERT INTO modulos_catalogo (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, orden) VALUES
  ('base',            'Base contable',            'Contable básico, caja/banco, facturación simple, panel, soporte', 20, 35, true,  10),
  ('catalogo_qr',     'Catálogo digital QR + mini-web', 'Carta/catálogo por QR, mini-web pública, multi-idioma opcional', 10, 18, false, 20),
  ('reservas_citas',  'Reservas y citas + bot',   'Formulario, panel, bot de botones, notificaciones',               10, 18, false, 30),
  ('inventario',      'Inventario',               'Stock, movimientos, disponibilidad en catálogo',                   8, 14, false, 40),
  ('rrhh',            'RRHH',                     'Empleados, turnos, nómina simple',                                 8, 14, false, 50),
  ('contabilidad_avanzada', 'Contabilidad avanzada', 'Plan de cuentas, modo dual, rol contador externo',             8, 14, false, 60),
  ('multinegocio',    'Multi-negocio',            'Varias empresas/locales con consolidación',                       12, 20, false, 70),
  ('marketing',       'Marketing y reseñas',      'Google Business, reseñas, promos',                                 6, 10, false, 80),
  ('asistente_ia',    'Asistente IA',             'Chat con clientes, NL para reservas/pedidos, consultas del dueño', 15, 25, false, 90)
ON CONFLICT (clave) DO NOTHING;

-- 4. Grants a service_role (toda la app accede vía service_role; patrón de 011_grants_rls.sql)
ALTER TABLE modulos_catalogo ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.modulos_catalogo TO service_role;

-- 5. Recargar caché de PostgREST
notify pgrst, 'reload schema';
```

> Las claves del seed son las del **modelo público nuevo**. Los 14 módulos ERP actuales (`ventas`, etc.)
> conviven: son submódulos de gestión que ya gatea el sidebar. Al implementar se decide si se fusionan bajo
> las claves nuevas (p.ej. `inventario` ya coincide) o se mantienen como sub-flags.

## 5. Cambios de código al implementar (resumen, NO hacer aún)

- **Gating** — `src/app/portal/(app)/layout.tsx`: cambiar la query que hoy lee `plans.modulos` por
  `clients.modulos_activos`. `PortalSidebar` **no se toca**.
- **Admin** — en el detalle de cliente (`src/app/admin/(protected)/clientes/[client_id]/`): UI de **toggle
  por módulo** que actualiza `modulos_activos` y **recalcula** `precio_mensual_usd` = precio de `base` +
  Σ precios de los módulos activos según `clients.tarifa`. Server action nueva en
  `src/app/actions/clientes.ts`.
- **Catálogo** — pantalla admin para CRUD de `modulos_catalogo` (editar precios fundador/estándar).
- **Plans** — el CRUD de `/admin/planes` se **deprecia** (no se borra de golpe; el histórico de pagos sigue
  usando `plan_id`).

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

## 8. Qué falta y cómo seguir (checklist de implementación)

Cuando se decida implementar el modelo (no en esta sesión), en este orden:

1. **Ajustar precios** del seed (§4) al catálogo vigente de CONTEXTO §5 y **aplicar** la migración:
   promoverla a `supabase/migrations/017_modulos_catalogo.sql` y correrla (`supabase db push` o SQL Editor).
2. **Cambiar el gating**: en `src/app/portal/(app)/layout.tsx`, leer `clients.modulos_activos` en vez de
   `plans.modulos`.
3. **Admin de toggle**: UI en el detalle de cliente + server action que actualiza `modulos_activos` y
   recalcula `precio_mensual_usd`. Recálculo: `base + Σ módulos activos` según `tarifa`.
4. **Admin de catálogo**: CRUD de `modulos_catalogo` (precios).
5. **Migrar clientes existentes**: rellenar `modulos_activos`/`tarifa`/`precio_mensual_usd` a partir de su
   `plans.modulos` actual (script de una vez).
6. **Deprecar** el CRUD de `/admin/planes` y limpiar la duplicación de la constante `MODULOS` (hoy en 3
   archivos) hacia una sola fuente, idealmente leída de `modulos_catalogo`.

## 9. Discrepancias detectadas (registro, con recomendación)

| # | Discrepancia | Recomendación |
|---|---|---|
| D1 | `crearPlan` guarda `plans.modulos` como **array** ([planes.ts:61](../src/app/actions/planes.ts)) pero `actualizarPlan` lo guarda como **CSV string** ([planes.ts:95](../src/app/actions/planes.ts)); el portal espera array → **editar un plan puede romper su gating**. | Corregir al implementar el modelo (queda obsoleto con `clients.modulos_activos`). Anotado, no tocar ahora. |
| D2 | `plans.precio_usd` / `nivel` / `modalidad` (precio único por tier) | Superado por el precio compuesto. |
| D3 | `docs/CLAUX-LEGACY.md` usa nombres Básico/Profesional/Empresarial | Ya marcado superado en CONTEXTO §2; al editar LEGACY, alinear. |
| D4 | `plans.max_empresas` / `max_usuarios` (límites en el plan) | Decidir en implementación si pasan a `clients` o al módulo `multinegocio`. Anotado. |
| D5 | `BloqueadoScreen` solo cubre SUSPENDIDO/VENCIDO; la degradación gradual (aviso→degradación→corte, CONTEXTO §8) está parcial | Anotado para la fase de corte por impago. |

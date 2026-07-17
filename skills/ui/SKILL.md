---
name: ui
description: Fuente ÚNICA y COMPLETA de UI del design system de CLAUX (reglas + tablas + tokens + iconos + gotchas). Usar SIEMPRE que se cree, edite o revise CUALQUIER componente, página, layout, estilo o CSS — incluso si la tarea solo dice "añade un botón", "cambia un color", "crea una página", "maqueta esto" o "ajusta el espaciado". Si la tarea toca un .tsx con JSX visible o un parcial de src/app/styles/, esta skill aplica y basta: no hace falta abrir ningún otro doc para UI. Regla central: NUNCA estilos inline.
---

# CLAUX UI — Design system y reglas de implementación

Esta skill es la **fuente única** de todo lo de UI. Para una tarea de UI no necesitas abrir ningún otro documento. Los **valores exactos** de tokens viven en código: `src/app/styles/01-tokens.css` (fuente viva, no se copian aquí para que no deriven).

## 0. Dónde vive el CSS

`src/app/globals.css` **solo orquesta** `@import` — su orden es la cascada, no reordenar; no escribas reglas ahí. El CSS real está partido en **8 parciales por orden de cascada** en `src/app/styles/`:

| Parcial | Dominio (dónde crear una clase nueva) |
|---|---|
| `01-tokens.css` | Custom properties (color/espaciado/texto/radio/sombra/tipografía). Fuente de valores. |
| `02-base-layout.css` | Reset, base del documento, contenedores de layout |
| `03-components.css` | Componentes genéricos: `.btn*`, `.input*`, `.table*`, `.modal*`, `.badge*`, `.card*`, `.alert*` |
| `04-responsive-dark.css` | Ajustes responsive y de modo oscuro |
| `05-admin-paginas.css` | Pantallas del `/admin` |
| `06-portal.css` | Portal y módulos del cliente |
| `07-ventas-actividad.css` | Ventas / actividad financiera |
| `08-landing.css` | Público (landing, mini-webs, catálogo/reserva públicos) |

**Localiza una clase antes de crear**: `grep -rn "nombre-aproximado" src/app/styles/`. El sistema ya tiene botones, inputs, navegación, tablas, modales, badges, cards, alertas y estados.

## 1. Regla nº1 — prohibido el estilo inline

Nunca escribas `style={{ ... }}` en JSX ni `style=""` en HTML. Sin excepciones de comodidad ("es solo un margen") — esa es exactamente la vía por la que el sistema se degrada.

**Proceso obligatorio al necesitar un estilo:**
1. **Busca** una clase existente (`grep` arriba).
2. **Reutiliza** si existe; **extiende** con un modificador si casi existe (`.btn-danger` junto a `.btn-primary`).
3. **Crea** la clase en el parcial de su dominio (tabla §0), en kebab-case con prefijo de componente (`.reserva-card`, `.menu-item-precio`), bajo un comentario separador `/* ── Componente ── */`.

Si lo que necesitas es una **variante de algo compartido** (un botón, un badge), va en `03-components.css` con el resto de la familia — no la reescribas a mano dentro de tu componente. `.imp-banner-btn` se escribió así, clavado a su banner, y el resultado fue que el dossier no pudo reutilizarlo y acabó con un botón teal sobre un aviso ámbar. Botones disponibles: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger(-text)`, `.btn-success`, `.btn-info` y **`.btn-aviso`** (la acción de dentro de un aviso ámbar: `--color-warning-bg` de fondo, como `.dos-desfase` o `.imp-banner`; no es «un botón ámbar» para usar suelto). Tamaños: `.btn-sm`, `.btn-lg`, `.btn-full`.

**Única excepción válida:** un valor que solo se conoce en runtime (ancho de barra de progreso, color elegido por el tenant). Aun así no se estila inline: se pasa como custom property y la clase la consume:

```tsx
<div className="progress-bar" style={{ '--progress': `${pct}%` } as React.CSSProperties} />
```
```css
.progress-bar::after { width: var(--progress); }
```

## 2. Tokens siempre, valores mágicos nunca

Todo color, espaciado, tamaño de texto, radio, sombra y transición sale de custom properties: `var(--color-*)`, `var(--space-*)`, `var(--text-*)`, `var(--radius-*)`, `var(--shadow-*)`, `var(--transition)`. Prohibido hardcodear hex, px arbitrarios o duraciones. Si un valor no existe y se repetirá, se crea el token en `01-tokens.css`, no el valor suelto. **No copies hex desde memoria ni desde docs viejos**: cita el token y, si dudas del valor, abre `01-tokens.css`.

Resumen de familias (nombres, no valores — mira `01-tokens.css`):
- **Paleta:** teal de marca (`--color-primary*`) + ámbar caribe (`--color-amber*`). El color se reserva para CTA/acentos.
- **Cromo vs tinta** — la trampa que más veces se ha roto. El tono vivo (`--color-primary`, `--color-amber`) es RELLENO grande: banda, degradado, barra de gráfico, con texto blanco encima. Como TINTA —icono, texto, borde o trazo sobre fondo pálido— desaparece (el ámbar vivo da 1.9:1 sobre su propio chip; el mínimo es 3:1). Para tinta hay token propio: `--color-primary-text`, `--color-amber-text`. Y `-active` es un tercer papel: tono estable de banda, no cambia con el tema porque siempre lleva blanco encima.
- **Superficies** (crema cálida): `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-surface-offset(-2)`, `--color-divider`, `--color-border(-strong/-focus)`.
- **Texto** (carbón cálido): `--color-text`, `--color-text-muted`, `--color-text-faint`, `--color-text-inv`.
- **Estados**: cada uno es un **par color + fondo**: `--color-success` + `--color-success-bg` (idem `error`, `warning`, `info`, y `purple/indigo/rose` para badges). Ojo al naming: el fondo es **`-bg`**, no `-highlight`.
- **Tipografía:** dos familias vía `--font-display` (títulos y `--text-xl`↑) y `--font-body` (todo lo operativo: labels, cuerpo, botones, tablas). Escala `--text-xs … --text-5xl` + `--text-hero`. Nunca fijes `font-family` a mano.

**Dark mode gratis:** cada token de color declara su par en una sola línea con `light-dark(claro, oscuro)`, y el tema lo elige `color-scheme` (el SO en `:root`, el usuario vía `[data-theme]`). **Nunca añadas un bloque `[data-theme="dark"]` con paleta**: había dos copiados a mano y se desincronizaban en silencio. Token nuevo = una línea con su par. Excepción: los tonos de banda (`-active`) y `--paper-*` no llevan par, a propósito. Verifica cualquier componente nuevo en **ambos temas** — y si su fondo es un token sin par, en oscuro te queda un recuadro crema.

**Tailwind v4 está SOLO como reset** (`@import "tailwindcss"`). Prohibido usar clases utilitarias de Tailwind en el markup.

## 3. Sistema de tablas — ÚNICO (todas iguales, presentes y futuras)

Toda tabla usa el sistema base `.table` + `.table-wrapper` de `03-components.css`. **No crees clases propias** de alineación, ancho de columna de acciones ni de importes — ya existen. Referencias: `TercerosView.tsx` (con botones), `VentasView.tsx` (sin botones).

**Alineación de columnas** — la MISMA clase modificadora va en el `<th>` y en el `<td>`:
- Cifras/importes/cantidades → **`col-num`** (derecha + `tabular-nums`). No uses `text-right` ni `*-col-monto`.
- Centrado → **`col-center`**. Acciones → **`col-actions`** (se ciñe al contenido, derecha).
- Texto libre largo → **`cell-truncate`** en el `<td>` (elipsis, sin scroll).

**Responsive (obligatorio):** cada `<td>` lleva **`data-label="<Cabecera>"`**. Bajo 640px la tabla se vuelve tarjetas apiladas (`etiqueta: valor`); sin ese atributo la tarjeta sale sin etiquetas. Las celdas `col-actions` no necesitan `data-label`.

**Acciones de fila:** con **2+ acciones**, un único menú `⋯` con `RowActions` (`src/components/portal/RowActions.tsx`) — nunca una fila de botones-icono (se amontonan). Items: `<button className="row-actions-item">` o `<Link className="row-actions-item">` (+ `-danger`/`-success`) con icono **y** texto. El menú va `fixed` (escapa del `overflow` de `.card-table`) y ya hace `stopPropagation`. Los enlaces heredan el color del texto; solo `-danger` va rojo. Con **1 sola acción**, icono directo (`.ter-action-btn`). Referencia: `GastosView.tsx`, `TercerosView.tsx`.

**Filas clickables** (tabla con detalle): `<tr className="table-row-clickable" onClick={() => router.push(...)}>`; el `<Link>` del nombre lleva `onClick={(e) => e.stopPropagation()}`.

**Color de empresa** (tablas multi-empresa): `<tr className="… row-empresa-accent" style={empresaColorVar(colorOf(id))}>` (única excepción al no-inline: custom property de runtime). Acento lateral izquierdo; en tarjeta pasa a `border-left`. No añadas más color que ese acento.

## 3.1 Pestañas internas — un solo componente

Toda pestaña interna usa **`<Tabs>`** (`src/components/Tabs.tsx`) + clases `.tabs`/`.tab`/`.tab-count` de `03-components.css`. Es presentacional y **controlado**: el padre guarda la pestaña activa (`useState`) y pasa `tabs`, `active`, `onChange`. Conteos opcionales con `count` (pill); `countTone: 'warning'` para conteos de alerta (p. ej. sin leer). **No crees familias nuevas** de pestañas: `.usr-/.ven-/.detail-/.prd-/.res-/.rrhh-/.caja-/.pv-` son **legado a converger**, no a imitar. El portal todavía usa algunas; al tocar esas vistas, migra a `<Tabs>`. Desde un Server Component, extrae un envoltorio cliente (patrón: `configuracion/ConfiguracionTabs.tsx`, recibe los paneles ya resueltos como props).

## 4. Iconos

Sin emojis en la UI. Iconos **exclusivamente SVG inline** con `width`/`height` como atributos (no solo CSS), `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor" strokeWidth="2"`. Para que no se compriman en el sidebar, usa una clase con `flex-shrink:0` en CSS — **no** `style={{flexShrink:0}}` inline.

## 5. Reglas UX innegociables

- Indicador de carga visible desde el primer clic hasta la respuesta.
- El botón de acción se deshabilita inmediatamente tras el clic; se reactiva solo si la operación falla.
- Sin respuesta en 15 s → mensaje amigable con opción de cancelar. Nunca pantalla congelada.
- Acciones críticas (registrar pago, anular factura, confirmar reserva, cerrar período) → resumen + confirmación explícita.
- **Prohibidos `confirm()`, `alert()` y `prompt()` del navegador**: son del sistema, no de CLAUX, y en móvil se ven como un aviso del navegador. Todo borrado (y cualquier acción irreversible) confirma con **`<ConfirmDialog>`** de `src/components/portal/Dialog.tsx` (`danger`, `confirmLabel="Eliminar"`); los errores van a toast, no a `alert()`. El estado de confirmación vive en el **padre** (`const [confirmarBorrado, setConfirmarBorrado] = useState<T|null>(null)`), nunca dentro de la fila o del menú `RowActions`: el botón solo hace `setConfirmarBorrado(item)`. Referencia: `CatalogoEditor.tsx`, `ModulosPageClient.tsx`. Sobre un panel flotante (chat IA), el diálogo ya va en `dialog-top` (z-index por encima).
- Tras guardar, feedback de éxito visible con el identificador generado.

## 6. Rutas públicas por-negocio (menú/catálogo QR, reservar, citas) — presupuesto Cuba, INNEGOCIABLE

Son los enlaces que se comparten con el cliente final en conexión pésima (Cuba, 3G). **Presupuesto duro: carga mínima.** Regla excepcional, **aislada del portal** — la arquitectura ya está montada así a propósito:

- **NO cargan `globals.css` ni nada del design system del portal.** Viven en `src/app/(public)/`, cuyo `layout.tsx` importa solo `public-base.css` (reset mínimo). `globals.css` se importa en los layouts de `admin/`, `portal/`, `landing/`, `diagnostico/` — **nunca** en el root ni en `(public)/`. No importes globals ni tokens del portal aquí: romperías el aislamiento (el público pasó de 234 KB de CSS a ~8 KB).
- **Cada ruta trae su hoja propia con paleta namespaced**: `catalogo-publica.css` (`--cp-*`) y `reserva-publica.css` (`--rp-*`), definidas en un wrapper `.cp-page`/`.rp-page`. No aliasar los tokens del portal.
- **Fuentes del sistema** (`system-ui`), nunca fuentes web: no uses `<BrandFonts>` aquí.
- Imágenes WebP/AVIF, sin librerías de UI pesadas, JS mínimo (Server Component siempre que se pueda). Objetivo: < 100 KB inicial, útil en 3G, PWA/offline donde aplique.

> **Landing y diagnóstico** (`/landing`, `/diagnostico`) son marketing propio de CLAUX, no mini-webs de negocio: esos **sí** usan el design system (cargan `globals.css` + `<BrandFonts>` en su layout). El aislamiento duro es **solo** para `(public)/[slug]/*`.

## 7. Accesibilidad mínima

Todo `<input>` con `<label for>` asociado por `id`. Todo botón de solo icono con `aria-label`. Contraste resuelto por tokens (no inventar combinaciones fuera de la paleta). Respetar `prefers-reduced-motion` en cualquier animación nueva.

## 8. Gotchas que ya nos mordieron (leer antes de tarjetas, menús y vistas públicas)

- **`transform` en hover crea bloque contenedor** → descoloca los menús `position:fixed` hijos (p. ej. `RowActions`, `.cat-card`). No uses `transform` en una tarjeta que contiene un menú `fixed`.
- **`opacity` en un contenedor se hereda a hijos `position:fixed`** (el menú `fixed` sale transparente y por detrás). Para "agotado" u otros atenuados: atenúa foto + textos, **no** el contenedor.
- **`.input-hint` (portal) ≠ `.rp-hint`** (solo existe en la hoja pública de reservar). No mezclarlas.
- **Antes de tocar una vista pública, lee su hermana del mismo ámbito** (público → público): usan paleta propia, no los tokens del portal (§6).
- **Contenedor de tamaño estable entre pasos** de un flujo (ancho fijo + `min-height`) para que la tarjeta no encoja a su contenido al cambiar de paso.
- **Reveal al hacer scroll: el estado base es VISIBLE, y el JS opta *por* la animación.** Nunca `opacity:0` de base "y ya lo mostrará el observer": si el JS no llega (3G, JS off, error de hidratación), la página queda invisible **para siempre**. Se hace al revés: el JS añade una clase al root (`.dp-anim`) y solo bajo ella el CSS oculta y revela. Referencia: `(public)/d/[token]/DeckReveal.tsx`.
- **Texto sobre un color de runtime necesita un color de texto calculado, no elegido a ojo.** Si el color lo pone el tenant, el contraste hay que derivarlo (`lib/dossier/paleta.ts` → `principalTexto`, ≥4.5:1 garantizado). Poner `color:#FFF` sobre un color derivado es inventarse una legibilidad que nadie ha comprobado. Si no tienes un texto calculado para ese color, no pongas texto encima: la etiqueta al lado.
- **Botón de acción del `.page-header` que se cae debajo del título:** el header es `flex-wrap:wrap`; si el bloque de texto no encoge, un subtítulo largo copa la fila y empuja la acción abajo (era el caso de Diagnóstico/Módulos). Ya resuelto en la base: el primer hijo lleva `flex:1 1 20rem; min-width:0` y las acciones `flex-shrink:0` (`02-base-layout.css`). Regla: el bloque de texto y la acción son **hermanos** dentro de `.page-header`; nunca metas el botón dentro del bloque de texto.
- **Hora de reloj en un componente cliente ⇒ fíjale la zona.** `toLocaleTimeString()` sin `timeZone` da una hora en el SSR (UTC en Vercel) y otra en el navegador → **mismatch de hidratación**, y encima una hora que no es la del negocio. Usa `TZ_NEGOCIO` de `src/lib/fecha-tz.ts` (America/Havana). Formatear solo la FECHA desde `'YYYY-MM-DD'` con `new Date(y, m-1, d)` es seguro y es lo que hace el resto del repo.

## 9. Checklist antes de dar por terminada una tarea de UI

1. ¿Cero `style={{` nuevos en el diff? (excepción: custom property de runtime documentada).
2. ¿Cero hex/px/ms hardcodeados nuevos? ¿Todo por token?
3. ¿Cero clases utilitarias de Tailwind?
4. ¿Clases nuevas en el parcial de su dominio (§0), con prefijo de componente?
5. Si hay tabla: ¿`col-*` en `th`+`td`, `data-label` en cada `td`, `RowActions` si 2+ acciones?
6. ¿Probado en dark mode y en móvil 360 px?
7. ¿Estados de carga, doble-submit y feedback cubiertos si hay acciones?

---
*Presupuesto: este archivo ≤ ~1.400 palabras. Si crece, factoriza — los valores exactos viven en `01-tokens.css`, no aquí.*

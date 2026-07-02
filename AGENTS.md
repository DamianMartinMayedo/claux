<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# CLAUX — Guía para agentes

CLAUX es una plataforma SaaS multi-tenant para digitalizar negocios locales cubanos (principalmente restaurantes). El núcleo de gestión (admin interno + portal ERP) ya existe; la capa pública (menú QR, reservas, bot de Telegram, landing) está en construcción. El estado real del código está en docs/CONTEXTO.md §2. Stack: Next.js 16 + Supabase + design system propio.

## Lectura obligatoria

**Antes de escribir cualquier código**, lee completo [docs/CONTEXTO.md](docs/CONTEXTO.md). Es la fuente de verdad del producto, la arquitectura y las prioridades de construcción.

> ## ⚠️ REGLA DE UI — INNEGOCIABLE (leer antes de tocar cualquier `.tsx` con JSX o CSS en `src/app/styles/`)
>
> Toca UI ⇒ **lee primero [skills/ui/SKILL.md](skills/ui/SKILL.md)**. No es opcional ni "para tareas grandes": aplica aunque solo añadas un botón, cambies un color o ajustes un margen.
>
> - **Prohibido el estilo inline** (`style={{…}}`). Única excepción: un valor de runtime pasado como custom property (documentado en la skill).
> - **Tokens y clases del design system siempre**: `var(--color-*)`, `var(--space-*)`, `var(--text-*)`, etc. El CSS vive en parciales por orden de cascada en `src/app/styles/` (orquestados por `src/app/globals.css`); localiza clases con `grep -rn "x" src/app/styles/`. Nada de hex/px mágicos.
> - **Tailwind solo es reset**: prohibido usar clases utilitarias de Tailwind en el markup.
> - Especificación visual completa (valores de tokens): `docs/CLAUX-LEGACY.md` §8.

> ## ⚠️ REGLA DE TABLAS — SISTEMA ÚNICO (todas iguales, presentes y futuras)
>
> Toda tabla usa el sistema base `.table` + `.table-wrapper` de `src/app/styles/03-components.css`. **No crees clases propias de alineación, ancho de columna de acciones ni de importes** — ya existen y se reutilizan. Referencias: `TercerosView.tsx` (con botones) o `VentasView.tsx` (sin botones).
>
> **Alineación de columnas** — la MISMA clase modificadora va en el `<th>` y en el `<td>` (así cabecera y dato quedan alineados):
> - Cifras/importes/cantidades → **`col-num`** (derecha + `tabular-nums`). No uses `text-right` ni clases `*-col-monto`.
> - Centrado → **`col-center`**. Columna de acciones → **`col-actions`** (se ciñe al contenido, derecha).
> - Texto libre largo (descripciones, direcciones) → **`cell-truncate`** en el `<td>` (elipsis, sin scroll).
>
> **Responsive (obligatorio)** — cada `<td>` lleva **`data-label="<Cabecera>"`** con el texto de su columna. Bajo 640px la tabla se convierte automáticamente en tarjetas apiladas (`etiqueta: valor`); sin ese atributo la tarjeta sale sin etiquetas. Las celdas de acciones (`col-actions`) no necesitan `data-label`.
>
> **Acciones de fila**: si una fila tiene **2+ acciones**, usa un único menú `⋯` con el componente `RowActions` (`src/components/portal/RowActions.tsx`) — no pongas una fila de botones-icono (se amontonan y recortan). Sus items son `<button className="row-actions-item">` (+ `-danger` / `-success`) con icono **y** texto. El menú se posiciona en `fixed` para escapar del `overflow` de `.card-table`, y ya hace `stopPropagation`. Con **1 sola acción**, deja el icono directo (`.ter-action-btn`). Referencia: `GastosView.tsx`, `TercerosView.tsx`.
>
> **Filas clickables** (tabla con página de detalle): `<tr className="table-row-clickable" onClick={() => router.push(...)}>`. El `<Link>` del nombre lleva `onClick={(e) => e.stopPropagation()}` para evitar doble navegación.
>
> **Color de empresa**: en tablas multi-empresa, `<tr>` lleva `className="… row-empresa-accent"` + `style={empresaColorVar(colorOf(id))}` (única excepción al no-inline: custom property de runtime). Se pinta como acento lateral izquierdo; en modo tarjeta pasa al `border-left`. No añadas más presencia de color que ese acento.

## Qué leer según la tarea (no sobre-leas)

| Tu tarea toca… | Lee (además de CONTEXTO.md) |
|---|---|
| Cualquier `.tsx`/JSX o CSS (`src/app/styles/`) | `skills/ui/SKILL.md` (obligatorio) + `docs/CLAUX-LEGACY.md` §8 si necesitas valores de tokens |
| Planes, módulos, precios, gating, admin de clientes | `docs/MODELO-MODULOS.md` |
| Base de datos / queries / esquema | sección relevante de `docs/CLAUX-LEGACY.md` + `skills/supabase-postgres-best-practices` |
| Lógica de negocio financiera (ventas, pagos, monedas) | sección relevante de `docs/CLAUX-LEGACY.md` |
| Código Next.js (RSC, rutas, cache, data) | `skills/next-best-practices` (+ `next-cache-components` si usas `use cache`/PPR) |

Lee solo lo que tu tarea necesita. De `docs/CLAUX-LEGACY.md` usa sus encabezados para leer la sección puntual, nunca el archivo entero.

## Índice de documentación (`docs/`)

| Documento | Qué contiene | Cuándo consultarlo |
|---|---|---|
| [CONTEXTO.md](docs/CONTEXTO.md) | Visión del producto, estado actual del código, principios de arquitectura, modelo de datos, prioridades de Fase 0 | Siempre antes de empezar cualquier tarea |
| [CLAUX-LEGACY.md](docs/CLAUX-LEGACY.md) | Design system completo (tokens, clases CSS, layout), esquema de BD, flujos financieros, convenciones de código | Al trabajar con UI/estilos, base de datos o lógica de negocio |
| [MODELO-MODULOS.md](docs/MODELO-MODULOS.md) | Diseño del modelo comercial v2 (módulos à la carte; la contabilidad es un módulo más, no una base obligatoria): tablas, gating, nomenclatura genérica, IA como módulo, discrepancias y checklist de implementación | Al implementar planes/módulos/precios, gating del portal o el admin de clientes |

## Política de eficiencia (ahorro de tokens)

- Lee docs/CONTEXTO.md completo UNA vez por sesión. De docs/CLAUX-LEGACY.md lee solo la sección relevante a la tarea (usa sus encabezados), nunca el archivo entero.
- Una sola fuente por tema: prohibido duplicar contenido entre documentos. Si algo cambia, edita el documento en su sitio; no añadas changelogs, resúmenes ni archivos nuevos que repitan lo existente.
- Prohibido crear archivos .md en la raíz. Documentación nueva solo en docs/, y solo si docs/CONTEXTO.md no puede absorberla; al crearla, regístrala en el índice de este archivo.
- Si una tarea cambia la arquitectura o el estado del código, actualiza docs/CONTEXTO.md §2 al terminar, en lugar de generar informes sueltos.
- Documento obsoleto se elimina, no se conserva "por si acaso".
- Toda regla de estilos e implementación de UI vive en skills/ui/SKILL.md — no se duplica aquí ni en otros documentos.

## Regla de precedencia

Ante cualquier contradicción entre documentos, el orden de prioridad es:

1. **docs/CONTEXTO.md** — prevalece siempre
2. docs/CLAUX-LEGACY.md
3. Cualquier otro documento

## Skills instaladas (13)

Curadas para el stack real (Next.js 16 + React 19 + Supabase + design system propio en CSS, sin utilidades Tailwind, sin backend Express). Se eliminaron las que se solapaban o no encajaban.

- `skills/ui/SKILL.md` → SIEMPRE que se cree, edite o revise cualquier componente, página, layout o CSS (cualquier .tsx con JSX o globals.css). Ver el bloque "REGLA DE UI" arriba. Regla central: prohibido el estilo inline; tokens y clases del design system siempre.
- `skills/emil-design-eng/SKILL.md` → al pulir detalles de UI, animaciones, interacciones y decisiones de diseño que hacen que el software se sienta bien.
- `skills/accessibility/SKILL.md` → al auditar o mejorar accesibilidad web (WCAG 2.2, screen readers, navegación por teclado).
- `skills/seo/SKILL.md` → al optimizar visibilidad en buscadores (meta tags, structured data, sitemap, technical SEO) — clave para landing y páginas públicas.
- `skills/core-web-vitals/SKILL.md` → al optimizar Core Web Vitals (LCP, INP, CLS); crítico para el presupuesto de rendimiento de las páginas públicas (CONTEXTO §3).
- `skills/next-best-practices/SKILL.md` → al escribir o revisar código Next.js (convenciones de archivos, RSC, data patterns, metadata, error handling).
- `skills/next-cache-components/SKILL.md` → al trabajar con Cache Components, PPR, `use cache`, cacheLife y cacheTag en Next.js 16.
- `skills/next-upgrade/SKILL.md` → al actualizar Next.js a una nueva versión (migration guides y codemods).
- `skills/react-best-practices/SKILL.md` → al escribir, revisar o refactorizar código React/Next.js para optimizar rendimiento (waterfalls, bundle size, re-renders).
- `skills/composition-patterns/SKILL.md` → al refactorizar componentes con proliferación de props booleanos, construir librerías de componentes o diseñar APIs reutilizables.
- `skills/typescript-advanced-types/SKILL.md` → al implementar lógica de tipos compleja (generics, conditional types, mapped types, type safety).
- `skills/supabase-postgres-best-practices/SKILL.md` → al escribir, revisar u optimizar queries Postgres, diseñar esquemas o configurar Supabase.
- `skills/nodejs-best-practices/SKILL.md` → al tomar decisiones de arquitectura Node (patrones async, seguridad) en route handlers/server actions y el futuro webhook del bot.

Regla de auto-registro — obligatoria para TODO agente IA: antes de empezar cualquier tarea, escanea la carpeta `skills/` en la raíz del repo. Cada subcarpeta que contenga un archivo `SKILL.md` es una skill instalada. Si encuentras alguna que no aparezca en la lista de arriba, léela, añádela aquí (una línea: ruta → cuándo leerla, deducida de su descripción) y guarda este archivo antes de continuar. El propietario instala skills sin avisar; mantener esta lista al día es responsabilidad del agente, no del propietario.

Convención de ubicación: las skills SIEMPRE se almacenan en `skills/<nombre-skill>/SKILL.md`. Si aparecen en `.agents/skills/`, `.claude/skills/` u otra ubicación oculta, muévelas a `skills/` antes de registrarlas y actualiza cualquier referencia.

Regla de conflicto: si una skill contradice docs/CONTEXTO.md o el design system de docs/CLAUX-LEGACY.md, mandan estos últimos.

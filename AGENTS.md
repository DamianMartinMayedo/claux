<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# CLAUX — Guía para agentes

CLAUX es una plataforma SaaS multi-tenant para digitalizar negocios locales cubanos (principalmente restaurantes). El núcleo de gestión (admin interno + portal ERP) ya existe; la capa pública (menú QR, reservas, bot de Telegram, landing) está en construcción. El estado real del código está en docs/CONTEXTO.md §2. Stack: Next.js 16 + Supabase + design system propio.

## Lectura obligatoria

**Antes de escribir cualquier código**, lee completo [docs/CONTEXTO.md](docs/CONTEXTO.md). Es la fuente de verdad del producto, la arquitectura y las prioridades de construcción.

> ## ⚠️ REGLA DE UI — INNEGOCIABLE
>
> Tocas UI (cualquier `.tsx` con JSX visible o un parcial de `src/app/styles/`) ⇒ **lee primero [skills/ui/SKILL.md](skills/ui/SKILL.md)**. Es la **fuente única y completa** de UI (reglas, sistema de tablas, tokens, iconos, gotchas): con ella basta, no abras otro doc para UI. Aplica aunque solo añadas un botón, cambies un color o ajustes un margen. Regla central: **prohibido el estilo inline**; tokens y clases del design system siempre.

## Qué leer según la tarea (no sobre-leas)

| Tu tarea toca… | Lee (además de CONTEXTO.md) |
|---|---|
| Cualquier `.tsx`/JSX o CSS (`src/app/styles/`) | `skills/ui/SKILL.md` (fuente única de UI; valores de tokens en `src/app/styles/01-tokens.css`) |
| Planes, módulos, precios, gating, admin de clientes | `docs/MODELO-MODULOS.md` |
| Base de datos / queries / esquema | `skills/supabase-postgres-best-practices` + las migraciones reales en `supabase/migrations/` |
| Lógica de negocio financiera (ventas, pagos, monedas) | `docs/CONTEXTO.md` §2 (mapa de módulos + puntos de entrada) + el código de esa área |
| Código Next.js (RSC, rutas, cache, data) | `skills/next-best-practices` (+ `next-cache-components` si usas `use cache`/PPR) |

Lee solo lo que tu tarea necesita.

## Índice de documentación (`docs/`)

| Documento | Qué contiene | Cuándo consultarlo |
|---|---|---|
| [CONTEXTO.md](docs/CONTEXTO.md) | Visión del producto, estado actual del código, principios de arquitectura, modelo de datos, prioridades de Fase 0 | Siempre antes de empezar cualquier tarea |
| [MODELO-MODULOS.md](docs/MODELO-MODULOS.md) | Diseño del modelo comercial v2 (módulos à la carte; la contabilidad es un módulo más, no una base obligatoria): tablas, gating, nomenclatura genérica, IA como módulo, discrepancias y checklist de implementación | Al implementar planes/módulos/precios, gating del portal o el admin de clientes |
| [skills/ui/SKILL.md](skills/ui/SKILL.md) | Fuente única de UI: reglas, sistema de tablas, tokens, iconos, gotchas. Valores exactos en `src/app/styles/01-tokens.css` | Al tocar cualquier `.tsx` con JSX o CSS de `src/app/styles/` |

## Política de eficiencia (ahorro de tokens)

- Lee docs/CONTEXTO.md completo UNA vez por sesión. Del resto de docs y skills, lee solo la sección/archivo relevante a la tarea (tabla "qué leer según la tarea" arriba), nunca de más.
- Una sola fuente por tema: prohibido duplicar contenido entre documentos. Si algo cambia, edita el documento en su sitio; no añadas changelogs, resúmenes ni archivos nuevos que repitan lo existente.
- Prohibido crear archivos .md en la raíz. Documentación nueva solo en docs/, y solo si docs/CONTEXTO.md no puede absorberla; al crearla, regístrala en el índice de este archivo.
- **Planes de trabajo** (features grandes, migraciones, refactors, recuperación de contexto entre agentes): al elaborar un plan de cierta envergadura, guarda una copia en `docs/planes/<nombre>.md` para que cualquier otro agente pueda leerlo y retomar. Esa carpeta está en `.gitignore` (no se versiona; es local a esta copia del repo); la convención completa vive en [docs/planes/README.md](docs/planes/README.md).
- Si una tarea cambia la arquitectura o el estado del código, actualiza docs/CONTEXTO.md §2 al terminar, en lugar de generar informes sueltos.
- Documento obsoleto se elimina, no se conserva "por si acaso".
- Toda regla de estilos e implementación de UI vive en skills/ui/SKILL.md — no se duplica aquí ni en otros documentos.

## Regla de precedencia

Ante cualquier contradicción entre documentos, el orden de prioridad es:

1. **docs/CONTEXTO.md** — prevalece siempre (producto, arquitectura, estado)
2. **skills/ui/SKILL.md** — manda en todo lo de UI; los valores de tokens los fija el código (`src/app/styles/01-tokens.css`)
3. docs/MODELO-MODULOS.md
4. Cualquier otro documento

## Skills instaladas (13)

Curadas para el stack real (Next.js 16 + React 19 + Supabase + design system propio en CSS, sin utilidades Tailwind, sin backend Express). Se eliminaron las que se solapaban o no encajaban.

- `skills/ui/SKILL.md` → SIEMPRE que se cree, edite o revise cualquier componente, página, layout o CSS (cualquier .tsx con JSX o parcial de `src/app/styles/`). **Fuente única y completa de UI** (reglas, sistema de tablas, tokens, iconos, gotchas). Regla central: prohibido el estilo inline; tokens y clases del design system siempre.
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

Regla de conflicto: si una skill contradice docs/CONTEXTO.md, manda CONTEXTO.md. La excepción es la UI: en reglas de estilo/design system manda `skills/ui/SKILL.md` (y los valores de tokens, el código en `src/app/styles/01-tokens.css`).

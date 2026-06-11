<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# CLAUX — Guía para agentes

CLAUX es una plataforma SaaS multi-tenant para digitalizar negocios locales cubanos (principalmente restaurantes). El núcleo de gestión (admin interno + portal ERP) ya existe; la capa pública (menú QR, reservas, bot de Telegram, landing) está en construcción. El estado real del código está en docs/CONTEXTO.md §2. Stack: Next.js 16 + Supabase + design system propio.

## Lectura obligatoria

**Antes de escribir cualquier código**, lee completo [docs/CONTEXTO.md](docs/CONTEXTO.md). Es la fuente de verdad del producto, la arquitectura y las prioridades de construcción.

## Índice de documentación (`docs/`)

| Documento | Qué contiene | Cuándo consultarlo |
|---|---|---|
| [CONTEXTO.md](docs/CONTEXTO.md) | Visión del producto, estado actual del código, principios de arquitectura, modelo de datos, prioridades de Fase 0 | Siempre antes de empezar cualquier tarea |
| [CLAUX-LEGACY.md](docs/CLAUX-LEGACY.md) | Design system completo (tokens, clases CSS, layout), esquema de BD, flujos financieros, convenciones de código | Al trabajar con UI/estilos, base de datos o lógica de negocio |

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

## Skills instaladas

- `skills/ui/SKILL.md` → leerla SIEMPRE que se cree, edite o revise cualquier componente, página, layout o CSS (cualquier .tsx con JSX o globals.css). Regla central: prohibido el estilo inline; tokens y clases del design system siempre.

Regla de auto-registro — obligatoria para TODO agente IA: antes de empezar cualquier tarea, escanea la carpeta `skills/` en la raíz del repo. Cada subcarpeta que contenga un archivo `SKILL.md` es una skill instalada. Si encuentras alguna que no aparezca en la lista de arriba, léela, añádela aquí (una línea: ruta → cuándo leerla, deducida de su descripción) y guarda este archivo antes de continuar. El propietario instala skills sin avisar; mantener esta lista al día es responsabilidad del agente, no del propietario.

Convención de ubicación: las skills SIEMPRE se almacenan en `skills/<nombre-skill>/SKILL.md`. Si aparecen en `.agents/skills/`, `.claude/skills/` u otra ubicación oculta, muévelas a `skills/` antes de registrarlas y actualiza cualquier referencia.

Regla de conflicto: si una skill contradice docs/CONTEXTO.md o el design system de docs/CLAUX-LEGACY.md, mandan estos últimos.

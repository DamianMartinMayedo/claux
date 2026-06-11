---
name: ui
description: Reglas obligatorias de UI del design system de CLAUX. Usar SIEMPRE que se cree, edite o revise CUALQUIER componente, página, layout, estilo o CSS — incluso si la tarea solo dice "añade un botón", "cambia un color", "crea una página", "maqueta esto" o "ajusta el espaciado". Si la tarea toca un archivo .tsx con JSX visible o globals.css, esta skill aplica. Su regla central: NUNCA estilos inline.
---

# CLAUX UI — Design system y reglas de implementación

Fuente de tokens y especificación visual completa: `docs/CLAUX-LEGACY.md` §8 (leer esa sección ante cualquier duda de valores). Hoja de estilos única: `src/app/globals.css`.

## Regla nº 1 — Prohibido el estilo inline

Nunca escribas `style={{ ... }}` en JSX ni `style=""` en HTML. Sin excepciones de comodidad ("es solo un margen") — esa es exactamente la vía por la que el sistema se degrada.

**Proceso obligatorio al necesitar un estilo:**
1. **Busca** una clase existente: `grep -n "nombre-aproximado" src/app/globals.css`. El sistema ya tiene botones (`.btn`, `.btn-primary`, `.btn-ghost`), inputs (`.input`, `.input-label`), navegación, tablas, modales, badges y estados.
2. **Reutiliza** si existe. **Extiende** con un modificador si casi existe (`.btn-danger` junto a `.btn-primary`).
3. **Crea** la clase en `globals.css` solo si no hay nada: en la sección del componente correspondiente (o nueva sección con comentario separador `/* ── Componente ── */`), nombrada en kebab-case con prefijo del componente (`.reserva-card`, `.menu-item-precio`).

**Única excepción válida:** un valor que solo se conoce en runtime (ancho de una barra de progreso, color elegido por el tenant). Aun entonces, no se estila inline: se pasa como custom property y la clase lo consume:

```tsx
<div className="progress-bar" style={{ '--progress': `${pct}%` } as React.CSSProperties} />
```
```css
.progress-bar::after { width: var(--progress); }
```

## Tokens siempre, valores mágicos nunca

Todo color, espaciado, tamaño de texto, radio y transición sale de las custom properties de `globals.css`: `var(--color-*)`, `var(--space-*)`, `var(--text-*)`, `var(--radius-*)`, `var(--transition)`. Prohibido hardcodear hex, px arbitrarios o duraciones. Si un valor no existe como token y se repetirá, se crea el token, no el valor suelto. Los colores vía token garantizan el dark mode: verifica visualmente cualquier componente nuevo en ambos temas.

Tailwind v4 está presente SOLO como reset (`@import "tailwindcss"`). Prohibido usar clases utilitarias de Tailwind en el markup.

## Reglas UX innegociables (heredadas de CLAUX-LEGACY §7)

- Indicador de carga visible desde el primer clic hasta la respuesta.
- El botón de acción se deshabilita inmediatamente tras el clic; se reactiva solo si la operación falla.
- Sin respuesta en 15 s → mensaje amigable con opción de cancelar. Nunca pantalla congelada.
- Acciones críticas (registrar pago, anular factura, confirmar reserva, cerrar período) → resumen + confirmación explícita.
- Tras guardar, feedback de éxito visible con el identificador generado.
- Sin emojis en la UI. Iconos exclusivamente SVG.

## Páginas públicas (menú QR, mini-web, landing, diagnóstico)

Presupuesto de carga inicial < 100 KB, mobile-first, utilizables en 3G. NO importan el CSS/JS del portal: usan un subconjunto crítico propio de tokens y clases. Imágenes optimizadas (AVIF/WebP con `next/image` o equivalente estático) y nada de librerías de UI pesadas.

## Accesibilidad mínima

Todo `<input>` con `<label for>` asociado por `id`. Todo botón de solo icono con `aria-label`. Contraste resuelto por tokens (no inventar combinaciones fuera de la paleta). Respetar `prefers-reduced-motion` en cualquier animación nueva.

## Checklist antes de dar por terminada una tarea de UI

1. ¿Cero `style={{` nuevos en el diff? (excepción custom property documentada arriba)
2. ¿Cero hex/px/ms hardcodeados nuevos?
3. ¿Cero clases utilitarias de Tailwind?
4. ¿Clases nuevas en su sección de `globals.css`, con prefijo de componente?
5. ¿Probado mentalmente en dark mode y en móvil 360 px?
6. ¿Estados de carga, doble-submit y feedback cubiertos si hay acciones?

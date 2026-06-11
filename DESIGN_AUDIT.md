# Auditoría de Diseño — CLAUX Design System v1.0

## 🚨 PROBLEMAS CRÍTICOS

### 1. **Errores de Sintaxis CSS**

#### Línea ~381-383: Transiciones incompletas
```css
a,
button {
  box-shadow var(--transition);  /* ❌ Falta : después de box-shadow */
  transition: color var(--transition), background var(--transition), border-color var(--transition),
  /* ❌ Coma colgante al final, transición incompleta */
}
```
**Fix:** 
```css
a, button {
  transition: color var(--transition), background var(--transition), 
              border-color var(--transition), box-shadow var(--transition);
}
```

#### Línea ~631: Font-weight typo
```css
font-weight:50  /* ❌ Debería ser 500 */
```

---

## 📐 PROBLEMAS DE ESTRUCTURA HTML

### 2. **HTML Malformado — Superficies anidadas incorrectamente**

Líneas ~746-769: Los `<div class="surface-layer">` están anidados erróneamente:
```html
<div class="surface-layer" style="background:var(--color-bg)">
  <div class="surface-layer-label">...</div>
  <div class="surface-layer-value">...</div>
  <div class="surface-layer" style="background:var(--color-surface)">  <!-- ❌ Anidación incorrecta -->
    ...
    <div class="surface-layer" ...>  <!-- ❌ Más niveles errados -->
```

**Problema:** Los divs internos NO se cierran. Estructura completamente rota.
**Resultado:** El navegador "arregla" automáticamente, pero rompe la semántica.

---

### 3. **Contraste de Accesibilidad — HTML Roto**

Líneas ~716-730: Los textos con `<span>` están fuera de contenedores:
```html
<div class="contrast-chip" style="...">
</div>
Texto principal <span class="contrast-ratio">9.8:1 ✓</span>  <!-- ❌ Fuera del div -->
<div class="contrast-chip" style="...">
</div>
Texto muted <span class="contrast-ratio">5.2:1 ✓</span>  <!-- ❌ Fuera del div -->
```

**Impacto:** Los ratios de contraste no se verán vinculados a sus chips.

---

## 🎨 PROBLEMAS DE DISEÑO Y COHERENCIA

### 4. **Abuso de Estilos Inline**

Hay **más de 50 atributos `style=""` inline** cuando debería haber clases reutilizables:

```html
<!-- ❌ Repeats everywhere: -->
<div style="font-size:var(--text-xs);color:var(--color-text-muted);font-weight:500;margin-bottom:var(--space-4);">
```

**Problema:** 
- No reutilizable
- Difícil de mantener
- Imposible de cambiar globalmente
- No respeta el DRY (Don't Repeat Yourself)

**Debería existir:**
```css
.section-description {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 500;
  margin-bottom: var(--space-4);
}
```

---

### 5. **Colores Hardcodeados en lugar de Variables**

En múltiples lugares hay colores directos:
```css
background: #1C1B16;  /* ❌ En lugar de var(--color-text) */
color: #CCCAC5;       /* ❌ En lugar de var(--color-text-inverse) */
```

**Líneas afectadas:**
- ~897 (`.brand-on-dark`): hardcodea `#1C1B16` y `#CCCAC5`
- ~878 (`.brand-on-color`): algunos valores sin variables
- Varias secciones con estilos inline hardcodeados

**Impacto:**
- Si cambia la paleta, estos colores NO se actualizan
- Tema oscuro no funciona bien en estas secciones
- Incoherencia visual

---

### 6. **Ausencia de Responsive Design**

El CSS **no tiene NINGÚN media query** para:
- Pantallas móviles
- Tabletas
- Reducción de espaciado en mobile

**Problemas detectados:**
- `.primary-palette` con `grid-template-columns: 2fr 1fr 1fr 1fr` se rompe en mobile
- `.grid-2`, `.grid-3`, `.grid-5` usan `minmax()` pero sin ajustes por viewport
- `.page` tiene `padding: var(--space-12) var(--space-6)` fijo (6rem vertical)
- Tipografía fluida pero sin límites en mobile/desktop

**Debería incluir:**
```css
@media (max-width: 768px) {
  .page { padding: var(--space-6) var(--space-3); }
  .primary-palette { grid-template-columns: 1fr; }
  .grid-2 { grid-template-columns: 1fr; }
}
```

---

### 7. **Inconsistencias en Espaciado y Tamaños**

- `.page` usa `--space-12` (3rem) de padding vertical → **muy grande** en mobile
- Algunos grids usan `gap: var(--space-4)`, otros `gap: var(--space-3)`
- Card padding: `var(--space-6)` (1.5rem) sin ajuste responsivo
- Input padding: `var(--space-3) var(--space-4)` (0.75rem/1rem) → puede ser pequeño

---

### 8. **Problema de Accesibilidad — Etiquetas Faltantes**

```html
<button class="theme-toggle" data-theme-toggle aria-label="Cambiar tema">
```

**Bien implementado aquí**, pero:
- Otros botones sin `aria-label` o texto descriptivo
- `.btn-ghost` sin suficiente contraste visual
- Inputs sin asociación correcta `<label for="id">`

```html
<!-- ❌ Actual: -->
<label class="input-label">Nombre del negocio</label>
<input class="input" type="text" placeholder="...">

<!-- ✅ Debería ser: -->
<label class="input-label" for="business-name">Nombre del negocio</label>
<input class="input" id="business-name" type="text" placeholder="...">
```

---

### 9. **Falta de Componentes Reutilizables**

Patrones repetidos sin clase:
```html
<!-- Repetido 10+ veces: -->
<div style="font-size:var(--text-xs);color:var(--color-text-muted);font-weight:500;margin-bottom:var(--space-4);">
```

Debería ser:
```css
.label-section, .label-subsection {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 500;
  margin-bottom: var(--space-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

---

### 10. **Tipografía Inconsistente**

El sistema define `--text-xs` a `--text-3xl` pero hay tamaños hardcodeados:
```html
<span class="tonal-step-label" style="font-size: 10px;">  <!-- ❌ 10px en lugar de --text-xs -->
```

También hay un `max-width: 65ch;` inline que debería ser una clase o variable.

---

### 11. **Falta de Tema Oscuro en Preview**

Los componentes de preview (botones, badges, inputs) **no tienen variantes para dark mode**:
```css
.btn-primary {
  background: var(--color-primary);  /* ✓ Correcto con variable */
  color: white;                       /* ❌ Debería revisar en dark mode */
}
```

En dark mode, `#00AFAA` sobre `#181714` puede tener contraste insuficiente.

---

### 12. **Sombras Incompletas**

El `data-theme="dark"` define nuevas sombras pero algunos elementos usan CSS inline:
```css
box-shadow: var(--shadow-sm);  /* ✓ Correcto */
```

Pero hay algunos estilos que no respetan:
```html
<div style="border:1px solid var(--color-divider);"></div>  <!-- ✓ Bien -->
```

---

## 📋 RESUMEN DE PRIORIDADES

| Prioridad | Problema | Líneas | Impacto |
|-----------|----------|--------|---------|
| 🔴 Crítica | Error sintaxis CSS | 381-383, 631 | No compila correctamente |
| 🔴 Crítica | HTML malformado | 746-769 | Estructura rota |
| 🟠 Alta | Estilos inline excesivos | Múltiples | Mantenibilidad |
| 🟠 Alta | Sin responsive design | - | No funciona en mobile |
| 🟠 Alta | Colores hardcodeados | 897, y otros | Dark mode roto |
| 🟡 Media | Falta accesibilidad | Inputs, botones | WCAG no cumplida |
| 🟡 Media | Sin clases reutilizables | Múltiples | Código repetido |

---

## ✅ RECOMENDACIONES

1. **Validar CSS** → Usar herramienta como [stylelint](https://stylelint.io/)
2. **Refactorizar estilos inline** → Crear clases `.label-section`, `.card-description`, etc.
3. **Agregar media queries** → Responsive desde 320px hasta 1920px
4. **Arreglar HTML** → Validar con [W3C Validator](https://validator.w3.org/)
5. **Mejorar accesibilidad** → Asociar labels con inputs, revisar ARIA
6. **Reemplazar colores hardcodeados** → Usar variables CSS en todos lados
7. **Crear componentes documentados** → HTML/CSS limpios, sin inline styles
8. **Testing en dark mode** → Verificar contraste y visibilidad

# CLAUX Design System — Guía de Refactorización

## 🛠️ Ejemplos de Correcciones

### Problema 1: Estilos Inline Repetitivos

#### ❌ ACTUAL (Repite 15+ veces):
```html
<div style="font-size:var(--text-xs);color:var(--color-text-muted);font-weight:500;margin-bottom:var(--space-4);">
  Escala Tonal — Teal CLAUX
</div>
```

#### ✅ CORRECCIÓN:
```css
/* En <style> */
.section-subtitle {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 500;
  margin-bottom: var(--space-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

```html
<div class="section-subtitle">Escala Tonal — Teal CLAUX</div>
```

---

### Problema 2: Error de Sintaxis en Transiciones

#### ❌ ACTUAL:
```css
a,
button {
  box-shadow var(--transition);  /* Falta : */
  transition: color var(--transition), background var(--transition), 
              border-color var(--transition),  /* Coma colgante */
}
```

#### ✅ CORRECCIÓN:
```css
a,
button {
  transition: 
    color var(--transition),
    background var(--transition),
    border-color var(--transition),
    box-shadow var(--transition);
}
```

---

### Problema 3: Colores Hardcodeados

#### ❌ ACTUAL:
```css
.brand-on-dark {
  background: #1C1B16;      /* Hardcodeado */
  color: #CCCAC5;           /* Hardcodeado */
}
```

#### ✅ CORRECCIÓN:
```css
.brand-on-dark {
  background: var(--color-text);        /* Light: #1C1B16, Dark: #CCCAC5 */
  color: var(--color-text-inverse);     /* Invierte automáticamente */
}

/* O más específico: */
[data-theme="light"] .brand-on-dark {
  background: #1C1B16;
  color: #CCCAC5;
}

[data-theme="dark"] .brand-on-dark {
  background: #CCCAC5;
  color: #1C1B16;
}
```

---

### Problema 4: HTML Malformado (Superficies anidadas)

#### ❌ ACTUAL (Líneas 746-769):
```html
<div class="surface-layer" style="background:var(--color-bg)">
  <div class="surface-layer-label">--color-bg · Fondo de página</div>
  <div class="surface-layer-value">#F5F4EF / dark: #131210</div>
  <div class="surface-layer" style="background:var(--color-surface)">  <!-- ❌ NO CIERRA -->
    <div class="surface-layer-label">--color-surface · Cards y paneles</div>
    <div class="surface-layer-value">#F8F7F2 / dark: #181714</div>
    <div class="surface-layer" style="background:var(--color-surface-2)">  <!-- ❌ NO CIERRA -->
      <!-- ... más anidamiento roto -->
```

#### ✅ CORRECCIÓN:
```html
<div class="surface-stack">
  <div class="surface-layer" style="background:var(--color-bg)">
    <div class="surface-layer-label">--color-bg · Fondo de página</div>
    <div class="surface-layer-value">#F5F4EF / dark: #131210</div>
  </div>
  
  <div class="surface-layer" style="background:var(--color-surface)">
    <div class="surface-layer-label">--color-surface · Cards y paneles</div>
    <div class="surface-layer-value">#F8F7F2 / dark: #181714</div>
  </div>
  
  <div class="surface-layer" style="background:var(--color-surface-2)">
    <div class="surface-layer-label">--color-surface-2 · Contenido elevado</div>
    <div class="surface-layer-value">#FAFAF6 / dark: #1D1C19</div>
  </div>

  <div class="surface-layer" style="background:var(--color-surface-offset)">
    <div class="surface-layer-label">--color-surface-offset · Hover, seleccionado</div>
    <div class="surface-layer-value">#EEEDЕ8 / dark: #1A1917</div>
  </div>
</div>
```

---

### Problema 5: Contraste de Accesibilidad — Estructura Rota

#### ❌ ACTUAL (Líneas 716-730):
```html
<div class="contrast-row">
  <div class="contrast-chip" style="...">
  </div>
  Texto principal <span class="contrast-ratio">9.8:1 ✓</span>  <!-- ❌ Fuera del contenedor -->
```

#### ✅ CORRECCIÓN:
```html
<div class="contrast-row">
  <div class="contrast-chip" style="background:var(--color-bg);color:var(--color-text);border:1px solid var(--color-border);">
    Texto principal 
    <span class="contrast-ratio">9.8:1 ✓</span>
  </div>
  
  <div class="contrast-chip" style="background:var(--color-bg);color:var(--color-text-muted);border:1px solid var(--color-border);">
    Texto muted 
    <span class="contrast-ratio">5.2:1 ✓</span>
  </div>
  
  <div class="contrast-chip" style="background:var(--color-primary);color:white;">
    Blanco / Teal 
    <span class="contrast-ratio">5.1:1 ✓</span>
  </div>
</div>
```

---

### Problema 6: Responsive Design Faltante

#### ✅ AGREGAR al final del `<style>`:
```css
/* ─────────────────────────────────────────
   RESPONSIVE BREAKPOINTS
   ───────────────────────────────────────── */

@media (max-width: 1024px) {
  .page {
    padding: var(--space-10) var(--space-5);
  }
  
  .primary-palette {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  
  .grid-2 {
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }
}

@media (max-width: 768px) {
  .page {
    padding: var(--space-8) var(--space-4);
  }
  
  .brand-header {
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
  }
  
  .primary-palette {
    grid-template-columns: 1fr;
  }
  
  .grid-2, .grid-3, .grid-5 {
    grid-template-columns: 1fr;
  }
  
  .card {
    padding: var(--space-4);
  }
  
  .section {
    margin-bottom: var(--space-12);
  }
}

@media (max-width: 480px) {
  .page {
    padding: var(--space-6) var(--space-3);
    max-width: 100%;
  }
  
  .section-label {
    font-size: var(--text-xs);
    margin-bottom: var(--space-3);
  }
  
  .type-specimen {
    padding-left: var(--space-4);
  }
  
  .brand-name {
    font-size: var(--text-lg);
  }
  
  .contrast-row {
    flex-direction: column;
    gap: var(--space-2);
  }
}

/* Dark mode improvements */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

### Problema 7: Accesibilidad en Inputs

#### ❌ ACTUAL:
```html
<label class="input-label">Nombre del negocio</label>
<input class="input" type="text" placeholder="Ej: Tienda La Habana">
```

#### ✅ CORRECCIÓN:
```html
<div class="input-group">
  <label class="input-label" for="business-name">
    Nombre del negocio
    <span class="input-required" aria-label="obligatorio">*</span>
  </label>
  <input 
    id="business-name"
    class="input" 
    type="text" 
    placeholder="Ej: Tienda La Habana"
    required
    aria-describedby="business-name-help"
  >
  <span id="business-name-help" class="input-hint">
    Aparecerá en todas tus facturas y documentos
  </span>
</div>
```

```css
.input-required {
  color: var(--color-error);
  margin-left: var(--space-1);
}

.input-hint {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  margin-top: var(--space-1);
  display: block;
}
```

---

### Problema 8: Clase Reutilizable para Descripciones

#### ✅ AGREGAR:
```css
.subsection-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 500;
  margin-bottom: var(--space-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: block;
}

.description-text {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}

.code-block {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: var(--text-xs);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  overflow-x: auto;
  line-height: 2;
  display: block;
}
```

#### USO:
```html
<!-- En lugar de style="" -->
<span class="subsection-label">Carga de fuentes — HTML head</span>
<code class="code-block">...</code>
```

---

### Problema 9: Tema Oscuro Mejorado

#### ✅ AGREGAR SELECTORES ESPECÍFICOS:
```css
[data-theme="dark"] .input {
  background: var(--color-surface);
  border-color: var(--color-surface-offset);
}

[data-theme="dark"] .input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-highlight);
}

[data-theme="dark"] .card {
  background: var(--color-surface-2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

[data-theme="dark"] .btn-secondary {
  background: var(--color-surface-offset);
  border-color: var(--color-border);
}
```

---

## 📊 Checklist de Refactorización

- [ ] Validar CSS con stylelint
- [ ] Validar HTML con W3C Validator
- [ ] Eliminar 100% de estilos inline
- [ ] Crear clases para patrones repetidos
- [ ] Reemplazar colores hardcodeados por variables
- [ ] Agregar media queries responsivas
- [ ] Mejorar accesibilidad en inputs y buttons
- [ ] Testar tema oscuro completo
- [ ] Testar en mobile (320px-480px)
- [ ] Testar con lectores de pantalla
- [ ] Verificar contraste WCAG AA en todos lados


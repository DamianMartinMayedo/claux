'use client'

// ── Checkbox de cabecera de tabla (patrón de selección múltiple) ───────────────
//
// El de la fila «Seleccionar todo». Tiene tres estados, no dos: vacío, todo
// marcado, y el intermedio de «algunas sí». Ese tercero (`indeterminate`) NO
// existe como atributo HTML —no hay `<input indeterminate>`—: es una propiedad
// del elemento en el DOM y solo se puede poner por JS. De ahí el `ref`: React
// pinta el marcado y nosotros tocamos la propiedad sobre el nodo ya creado, en
// cada render, para que el guion siga al día cuando cambia la selección.
//
// Va con `useRowSelection` (qué filas hay marcadas) y `BulkBar` (qué hacer con
// ellas). Se coloca en el `th.col-check` de la tabla.

export default function HeaderCheck({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void
}) {
  return (
    <input type="checkbox" className="row-check" checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange} aria-label="Seleccionar todo" />
  )
}

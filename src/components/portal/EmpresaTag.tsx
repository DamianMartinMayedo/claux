import type { CSSProperties } from 'react'

// El color de empresa se inyecta como custom property --empresa-color y el CSS
// lo consume (clases .empresa-dot / .empresa-tag en 06-portal.css). Única
// excepción permitida al no-inline: un valor de runtime como custom property.
export function empresaColorVar(color?: string | null): CSSProperties {
  return { '--empresa-color': color ?? undefined } as CSSProperties
}

// Resuelve el color de una empresa a partir del Map id → empresa que muchas
// vistas ya construyen (ej. empresaMap en UsuariosView).
export function colorDeEmpresa(
  map: Map<string, { color?: string | null }>,
  id: string,
): string | undefined {
  return map.get(id)?.color ?? undefined
}

/** Punto de color suelto (leyendas, listas). */
export function EmpresaDot({ color }: { color?: string | null }) {
  return <span className="empresa-dot" style={empresaColorVar(color)} />
}

/** Nombre de empresa precedido de su punto de color (columnas "Empresa", desgloses). */
export function EmpresaTag({
  color,
  nombre,
}: {
  color?: string | null
  nombre: string
}) {
  return (
    <span className="empresa-tag" style={empresaColorVar(color)}>
      {nombre}
    </span>
  )
}

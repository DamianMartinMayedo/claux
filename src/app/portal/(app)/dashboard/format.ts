// Helpers de formato compartidos por los widgets del dashboard (server + client).

export function formatUSD(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

export function formatCompacto(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

// Importe con su código de moneda (no se asume USD). Convención CLAUX: número + código.
export function formatMoneda(n: number, moneda: string): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`
}

// Número compacto sin símbolo (para ejes/tooltips de gráficas, ya etiquetadas por moneda).
export function formatNumCompacto(n: number): string {
  return Math.round(n).toLocaleString('es-ES')
}

export function formatFecha(fecha: string): string {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`
}

export function fechaLarga(fechaISO: string): string {
  try {
    const s = new Date(`${fechaISO}T00:00:00`).toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    })
    return s.charAt(0).toUpperCase() + s.slice(1)
  } catch {
    return fechaISO
  }
}

// ── Geometría del gráfico de la serie — lógica pura, sin I/O ────────────────
//
// 12 puntos no justifican una librería: recharts pesa ~100 KB él solo, MÁS que
// el presupuesto entero del deck público (<100 KB, CONTEXTO §3). Esto devuelve
// paths de SVG y se acabó.
//
// La comparten el preview en vivo del wizard (cliente) y el deck (servidor).
// El tramo proyectado sale SEPARADO a propósito: colar una estimación como si
// fuera histórico es la forma más rápida de perder a un inversor, así que quien
// pinte esto está obligado a distinguirlo (trazo discontinuo + etiqueta).

export interface PuntoGrafico {
  x: number
  y: number
  valor: number
  proyectado: boolean
}

export interface GeometriaGrafico {
  ancho: number
  alto: number
  /** Polilínea del tramo real. '' si no hay histórico. */
  pathHistorico: string
  /** Polilínea del tramo estimado; arranca en el último punto real para que la
   *  línea no se corte. '' si no hay proyección. */
  pathProyectado: string
  /** Área bajo el tramo real (relleno suave). '' si no hay histórico. */
  areaHistorico: string
  puntos: PuntoGrafico[]
  maximo: number
}

const VACIO: GeometriaGrafico = {
  ancho: 0, alto: 0, pathHistorico: '', pathProyectado: '', areaHistorico: '',
  puntos: [], maximo: 0,
}

export function geometriaGrafico(
  historico: number[],
  proyectado: number[] = [],
  opts?: { ancho?: number; alto?: number; padding?: number },
): GeometriaGrafico {
  const ancho   = opts?.ancho ?? 640
  const alto    = opts?.alto ?? 180
  const padding = opts?.padding ?? 10

  const valores = [...historico, ...proyectado]
  if (valores.length === 0) return { ...VACIO, ancho, alto }

  // Escala desde 0: en dinero, una escala que no arranca en cero exagera la
  // pendiente y convierte un mes plano en un cohete. Aquí eso sería mentir.
  const maximo = Math.max(...valores, 0)
  const rango  = maximo > 0 ? maximo : 1

  const usableX = ancho - padding * 2
  const usableY = alto - padding * 2
  const ultimo  = valores.length - 1

  const px = (i: number) => padding + (ultimo === 0 ? usableX / 2 : (usableX * i) / ultimo)
  const py = (v: number) => padding + usableY - (usableY * Math.max(v, 0)) / rango

  const puntos: PuntoGrafico[] = valores.map((valor, i) => ({
    x: px(i), y: py(valor), valor, proyectado: i >= historico.length,
  }))

  const linea = (ps: PuntoGrafico[]) =>
    ps.length === 0 ? '' : ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const reales = puntos.slice(0, historico.length)
  // El tramo estimado arranca en el último real: sin ese punto de anclaje la
  // línea aparece flotando y se lee como otra serie distinta.
  const estimados = historico.length > 0 && proyectado.length > 0
    ? puntos.slice(historico.length - 1)
    : puntos.slice(historico.length)

  const pathHistorico = linea(reales)
  const base = padding + usableY
  const areaHistorico = reales.length > 1
    ? `${pathHistorico} L${reales[reales.length - 1].x.toFixed(1)},${base.toFixed(1)} L${reales[0].x.toFixed(1)},${base.toFixed(1)} Z`
    : ''

  return {
    ancho, alto,
    pathHistorico,
    pathProyectado: linea(estimados),
    areaHistorico,
    puntos,
    maximo,
  }
}

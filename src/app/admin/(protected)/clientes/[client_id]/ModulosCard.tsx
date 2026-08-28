'use client'

import { useRef, useState, useTransition } from 'react'
import { setModulosCliente, simularNivel } from '@/app/actions/clientes'
import { importeCiclo } from '@/lib/billing'
import { useToast } from '@/app/contexts/ToastContext'
import { NIVELES, normalizarNivel, precioModulo, type Nivel } from '@/lib/niveles'

type ModuloCatalogo = {
  clave: string
  nombre: string
  descripcion: string | null
  precio_inicial_usd: number
  precio_empresa_usd: number
  precio_pro_usd: number
  es_base: boolean
  tipo: string
}

type Props = {
  client_id:         string
  modulosActivos:    string[]
  nivel:             string
  /** Cómo se llama hoy cada nivel (`niveles.nombre`, editable desde /admin). */
  nombresNivel:      Record<Nivel, string>
  ciclo:             string
  precioMensual:     number
  descuentoAnualPct: number
  catalogo:          ModuloCatalogo[]
}

const GRUPOS: { label: string; tipo: string }[] = [
  { label: 'Módulos',         tipo: 'modulo' },
  { label: 'Funcionalidades', tipo: 'funcionalidad' },
  { label: 'Addons',          tipo: 'addon' },
]

export default function ModulosCard({
  client_id,
  modulosActivos,
  nivel: nivelInicial,
  nombresNivel,
  ciclo: cicloInicial,
  descuentoAnualPct,
  catalogo,
}: Props) {
  // La contabilidad ('base') es un módulo opcional como cualquier otro: no se
  // fuerza, el admin la activa/desactiva por cliente.
  const [seleccionados, setSeleccionados] = useState<string[]>(modulosActivos)
  const [nivel, setNivel] = useState<Nivel>(normalizarNivel(nivelInicial))
  const [ciclo, setCiclo]   = useState(cicloInicial || 'mensual')
  const [isPending, startTransition] = useTransition()
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()

  // Bajar de nivel no rompe nada, pero deja al cliente sin poder añadir en las
  // dimensiones donde ya se pasa. Eso se dice ANTES de guardar, no después: se
  // pregunta al servidor qué le cabría con el nivel elegido.
  const [excedidas, setExcedidas] = useState<{ etiqueta: string; usado: number; limite: number }[]>([])
  const [comprobando, setComprobando] = useState(false)
  const peticion = useRef(0)

  async function cambiarNivel(t: Nivel) {
    setNivel(t)
    setExcedidas([])
    if (t === normalizarNivel(nivelInicial)) return
    // Quien clica rápido entre los tres niveles genera respuestas que pueden
    // llegar desordenadas: solo manda la última pedida.
    const mio = ++peticion.current
    setComprobando(true)
    const r = await simularNivel(client_id, t)
    if (mio !== peticion.current) return
    setComprobando(false)
    if (r.ok) setExcedidas(r.excedidas)
  }

  const precioMensual = catalogo
    .filter(m => seleccionados.includes(m.clave))
    .reduce((sum, m) => sum + precioModulo(m, nivel), 0)
  const precioAnual = importeCiclo(precioMensual, 'anual', descuentoAnualPct)
  const ahorroAnual = Math.max(0, precioMensual * 12 - precioAnual)

  function toggle(clave: string) {
    setSeleccionados(prev =>
      prev.includes(clave) ? prev.filter(c => c !== clave) : [...prev, clave]
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const ld = toastLoading('Guardando módulos…')
    const fd = new FormData()
    fd.append('client_id', client_id)
    fd.append('nivel', nivel)
    fd.append('ciclo_facturacion', ciclo)
    seleccionados.forEach(m => fd.append('modulos', m))

    startTransition(async () => {
      const res = await setModulosCliente(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error al guardar'); return }
      toastSuccess(`Módulos actualizados · $${(res.precio_mensual_usd ?? 0).toFixed(2)}/mes`)
    })
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Módulos contratados</h2>
        <span className="badge badge-neutral">${precioMensual.toFixed(2)}/mes</span>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Nivel */}
        <div className="seg-field">
          <span className="seg-field-label">Nivel</span>
          <div className="seg">
            {NIVELES.map(t => (
              <label key={t} className="seg-opt">
                <input type="radio" name="nivel_ui" value={t} checked={nivel === t}
                  onChange={() => { void cambiarNivel(t) }} />
                <span>{nombresNivel[t]}</span>
              </label>
            ))}
          </div>
        </div>

        {comprobando && <p className="form-hint">Comprobando qué le cabría…</p>}
        {/* `mt-2` no es decoración: `.alert` solo trae `margin-bottom`, así que el
            aviso salía a 8px del segmentado (el `padding-bottom` de `.seg-field`)
            y a 16px de la lista — pegado a lo de arriba y suelto de lo de abajo.
            Con los otros 8px el hueco de arriba iguala al de abajo. */}
        {excedidas.length > 0 && (
          <div className="alert alert-warning mt-2">
            <strong className="alert-titulo">
              Con {nombresNivel[nivel]} se queda por encima en {excedidas.length}
            </strong>
            {excedidas.map(x => `${x.etiqueta}: tiene ${x.usado} y el tope sería ${x.limite}`).join(' · ')}.
            No se le borra nada: sigue trabajando con todo, pero no podrá añadir más de eso.
          </div>
        )}

        {/* Lista de módulos con switch */}
        {GRUPOS.map(grupo => {
          const items = catalogo.filter(m => m.tipo === grupo.tipo)
          if (!items.length) return null
          return (
            <div key={grupo.tipo} className="mod-list">
              <p className="mod-list-label">{grupo.label}</p>
              {items.map(m => {
                const activo = seleccionados.includes(m.clave)
                const precio = precioModulo(m, nivel)
                return (
                  <label key={m.clave} className="mod-row">
                    <span className="mod-row-main">
                      <span className="mod-row-name">{m.nombre}</span>
                      <span className="mod-row-desc">{m.descripcion}</span>
                    </span>
                    <span className={`mod-row-price${precio === 0 ? ' mod-row-price-free' : ''}`}>
                      {precio > 0 ? `+$${precio.toFixed(2)}` : 'Gratis'}
                    </span>
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={activo}
                        onChange={() => toggle(m.clave)}
                        aria-label={`Activar ${m.nombre}`}
                      />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                  </label>
                )
              })}
            </div>
          )
        })}

        {/* Ciclo de facturación */}
        <div className="seg-field">
          <span className="seg-field-label">Ciclo de cobro</span>
          <div className="seg">
            {(['mensual', 'anual'] as const).map(c => (
              <label key={c} className="seg-opt">
                <input type="radio" name="ciclo_ui" value={c} checked={ciclo === c}
                  onChange={() => setCiclo(c)} />
                <span>{c === 'mensual' ? 'Mensual' : 'Anual'}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Precio que paga el cliente: mensual y anual */}
        <div className="mod-precio-resumen">
          <div className={`mod-precio-card${ciclo === 'mensual' ? ' mod-precio-card-active' : ''}`}>
            <p className="mod-precio-label">Mensual</p>
            <p className="mod-precio-valor">${precioMensual.toFixed(2)}<span className="mod-precio-unidad">/mes</span></p>
          </div>
          <div className={`mod-precio-card${ciclo === 'anual' ? ' mod-precio-card-active' : ''}`}>
            <p className="mod-precio-label">Anual</p>
            <p className="mod-precio-valor">${precioAnual.toFixed(2)}<span className="mod-precio-unidad">/año</span></p>
            {descuentoAnualPct > 0 && precioMensual > 0 && (
              <p className="mod-precio-extra">Ahorra {descuentoAnualPct}% (${ahorroAnual.toFixed(2)}/año)</p>
            )}
          </div>
        </div>

        <div className="mod-footer">
          <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>
            {isPending ? <><span className="spinner" /> Guardando...</> : 'Guardar módulos'}
          </button>
        </div>
      </form>
    </div>
  )
}

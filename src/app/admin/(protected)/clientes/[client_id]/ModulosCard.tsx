'use client'

import { useState, useTransition } from 'react'
import { setModulosCliente } from '@/app/actions/clientes'
import { importeCiclo } from '@/lib/billing'
import { useToast } from '@/app/contexts/ToastContext'

type ModuloCatalogo = {
  clave: string
  nombre: string
  descripcion: string | null
  precio_fundador_usd: number
  precio_estandar_usd: number
  es_base: boolean
  tipo: string
}

type Props = {
  client_id:         string
  modulosActivos:    string[]
  tarifa:            string
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
  tarifa: tarifaInicial,
  ciclo: cicloInicial,
  descuentoAnualPct,
  catalogo,
}: Props) {
  // La contabilidad ('base') es un módulo opcional como cualquier otro: no se
  // fuerza, el admin la activa/desactiva por cliente.
  const [seleccionados, setSeleccionados] = useState<string[]>(modulosActivos)
  const [tarifa, setTarifa] = useState(tarifaInicial || 'estandar')
  const [ciclo, setCiclo]   = useState(cicloInicial || 'mensual')
  const [isPending, startTransition] = useTransition()
  const { success: toastSuccess, error: toastError, loading: toastLoading } = useToast()

  const precioField = tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'

  const precioMensual = catalogo
    .filter(m => seleccionados.includes(m.clave))
    .reduce((sum, m) => sum + Number(m[precioField] ?? 0), 0)
  const precioAnual = importeCiclo(precioMensual, 'anual', descuentoAnualPct)
  const ahorroAnual = Math.max(0, precioMensual * 12 - precioAnual)

  function clear() {}

  function toggle(clave: string) {
    setSeleccionados(prev =>
      prev.includes(clave) ? prev.filter(c => c !== clave) : [...prev, clave]
    )
    clear()
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const ld = toastLoading('Guardando módulos…')
    const fd = new FormData()
    fd.append('client_id', client_id)
    fd.append('tarifa', tarifa)
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
        {/* Tarifa */}
        <div className="seg-field">
          <span className="seg-field-label">Tarifa</span>
          <div className="seg">
            {(['estandar', 'fundador'] as const).map(t => (
              <label key={t} className="seg-opt">
                <input type="radio" name="tarifa_ui" value={t} checked={tarifa === t}
                  onChange={() => { setTarifa(t); clear() }} />
                <span>{t === 'estandar' ? 'Estándar' : 'Fundador'}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Lista de módulos con switch */}
        {GRUPOS.map(grupo => {
          const items = catalogo.filter(m => m.tipo === grupo.tipo)
          if (!items.length) return null
          return (
            <div key={grupo.tipo} className="mod-list">
              <p className="mod-list-label">{grupo.label}</p>
              {items.map(m => {
                const activo = seleccionados.includes(m.clave)
                const precio = Number(m[precioField] ?? 0)
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
                  onChange={() => { setCiclo(c); clear() }} />
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

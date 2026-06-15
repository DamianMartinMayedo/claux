'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearCliente } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
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
  catalogo:          ModuloCatalogo[]
  setupDefault:      number
  descuentoAnualPct: number
}

const GRUPOS: { label: string; tipo: string }[] = [
  { label: 'Contabilidad',       tipo: 'base' },
  { label: 'Módulos adicionales', tipo: 'modulo' },
  { label: 'Funcionalidades',     tipo: 'funcionalidad' },
]

export default function NuevoClienteModal({ catalogo, setupDefault, descuentoAnualPct }: Props) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<{ client_id: string; passwordTemporal: string } | null>(null)
  const { success: toastSuccess, error: toastError } = useToast()
  const mounted = useMounted()
  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const baseClave = catalogo.find(m => m.es_base)?.clave ?? 'base'
  const [seleccionados, setSeleccionados] = useState<string[]>([baseClave])
  const [tarifa, setTarifa] = useState('estandar')
  const [ciclo, setCiclo]   = useState('mensual')

  const precioField = tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
  const precioMensual = catalogo
    .filter(m => seleccionados.includes(m.clave))
    .reduce((sum, m) => sum + Number(m[precioField] ?? 0), 0)
  const precioAnual = importeCiclo(precioMensual, 'anual', descuentoAnualPct)
  const ahorroAnual = Math.max(0, precioMensual * 12 - precioAnual)

  function toggle(clave: string, esBase: boolean) {
    if (esBase) return
    setSeleccionados(prev =>
      prev.includes(clave) ? prev.filter(c => c !== clave) : [...prev, clave]
    )
  }

  const handleClose = useCallback(() => {
    setOpen(false)
    if (resultado) {
      setResultado(null)
      router.refresh()
    }
  }, [resultado, router])

  useModalKeyboard(open, handleClose)

  function handleOpen() {
    setSeleccionados([baseClave])
    setTarifa('estandar')
    setCiclo('mensual')
    setOpen(true)
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setLoading(true)
    const res = await crearCliente(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error desconocido'); return }
    setResultado({ client_id: res.client_id!, passwordTemporal: res.passwordTemporal! })
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-560">
        {resultado ? (
          <div className="modal-body modal-body-success">
            <div className="success-icon-circle">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="text-center">
              <h2 className="modal-title modal-success-title">Cliente creado</h2>
              <p className="modal-success-description">
                Guarda las credenciales iniciales del cliente.
              </p>
            </div>
            <div className="code-block">
              <div className="code-block-field">
                <label className="code-block-label">ID Cliente</label>
                <p className="code-block-value">{resultado.client_id}</p>
              </div>
              <div className="code-block-field">
                <label className="code-block-label">Contraseña temporal</label>
                <p className="code-block-value code-block-value-text">{resultado.passwordTemporal}</p>
              </div>
            </div>
            <button className="btn btn-primary btn-full" onClick={handleClose}>Listo</button>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Nuevo cliente</h2>
              <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form ref={formRef} onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="input-group">
                  <label>Nombre de la empresa <span className="required">*</span></label>
                  <input name="nombre_empresa" className="input" required placeholder="Ej: Empresa Ejemplo S.L." />
                </div>

                <div className="grid-cols-2">
                  <div className="input-group">
                    <label>Nombre del contacto</label>
                    <input name="nombre_contacto" className="input" placeholder="Administrador" />
                  </div>
                  <div className="input-group">
                    <label>Email del administrador <span className="required">*</span></label>
                    <input name="email_admin" type="email" className="input" required placeholder="admin@empresa.com" />
                  </div>
                </div>

                {/* Tarifa */}
                <div className="seg-field">
                  <span className="seg-field-label">Tarifa</span>
                  <div className="seg">
                    {(['estandar', 'fundador'] as const).map(t => (
                      <label key={t} className="seg-opt">
                        <input type="radio" name="tarifa" value={t} checked={tarifa === t}
                          onChange={() => setTarifa(t)} />
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
                              {m.descripcion && <span className="mod-row-desc">{m.descripcion}</span>}
                            </span>
                            <span className={`mod-row-price${precio === 0 ? ' mod-row-price-free' : ''}`}>
                              {m.es_base ? 'Incluida' : precio > 0 ? `+$${precio.toFixed(2)}` : 'Gratis'}
                            </span>
                            <span className="switch">
                              <input
                                type="checkbox"
                                name="modulos"
                                value={m.clave}
                                checked={activo}
                                disabled={m.es_base}
                                onChange={() => toggle(m.clave, m.es_base)}
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

                {/* Ciclo de cobro */}
                <div className="seg-field">
                  <span className="seg-field-label">Ciclo de cobro</span>
                  <div className="seg">
                    {(['mensual', 'anual'] as const).map(c => (
                      <label key={c} className="seg-opt">
                        <input type="radio" name="ciclo_facturacion" value={c} checked={ciclo === c}
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

                {/* Pago único de configuración */}
                <div className="input-group">
                  <label>Pago de configuración (USD)</label>
                  <input
                    name="pago_setup_usd"
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    defaultValue={setupDefault}
                  />
                  <span className="input-hint">Pago único inicial. Pon 0 para omitirlo. Se registra aparte de la suscripción.</span>
                </div>

                <label className="checkbox-group">
                  <input type="checkbox" name="es_trial" value="true" />
                  <span className="checkbox-label">Iniciar con período de prueba gratuita (sin cobro)</span>
                </label>

                <div className="input-group">
                  <label>Notas internas</label>
                  <textarea name="notas" className="input" rows={2} placeholder="Opcional" />
                </div>

              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading
                    ? <><span className="spinner" /> Creando...</>
                    : 'Crear cliente'
                  }
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={handleOpen}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nuevo cliente
      </button>

      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}

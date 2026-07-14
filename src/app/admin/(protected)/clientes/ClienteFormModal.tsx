'use client'

import { Check, X } from 'lucide-react'
import { toastError } from '@/app/contexts/ToastContext'
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearCliente } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { importeCiclo } from '@/lib/billing'

export type ModuloCatalogo = {
  clave: string
  nombre: string
  descripcion: string | null
  precio_fundador_usd: number
  precio_estandar_usd: number
  es_base: boolean
  tipo: string
}

export type PlantillaSector = {
  sector:  string
  nombre:  string
  modulos: string[]
  etiquetas: { catalogo?: string } | null
}

// Valores de precarga (p. ej. al crear un cliente desde un presupuesto aprobado).
export type InitialCliente = {
  nombre_empresa?:  string
  nombre_contacto?: string
  email_admin?:     string
  sector?:          string
  tarifa?:          'estandar' | 'fundador'
  ciclo?:           'mensual' | 'anual'
  modulos?:         string[]
  pago_setup_usd?:  number
}

type Props = {
  open:              boolean
  onClose:           () => void
  catalogo:          ModuloCatalogo[]
  plantillas:        PlantillaSector[]
  setupDefault:      number
  descuentoAnualPct: number
  initial?:          InitialCliente
  presupuestoId?:    number
}

const GRUPOS: { label: string; tipo: string }[] = [
  { label: 'Módulos',         tipo: 'modulo' },
  { label: 'Funcionalidades', tipo: 'funcionalidad' },
  { label: 'Addons',          tipo: 'addon' },
]

export default function ClienteFormModal({
  open, onClose, catalogo, plantillas, setupDefault, descuentoAnualPct, initial, presupuestoId,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<{ client_id: string; passwordTemporal: string; estado: string } | null>(null)
  const mounted = useMounted()
  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const [seleccionados, setSeleccionados] = useState<string[]>([])
  const [sector, setSector] = useState('')
  const [tarifa, setTarifa] = useState<'estandar' | 'fundador'>('estandar')
  const [ciclo, setCiclo]   = useState<'mensual' | 'anual'>('mensual')

  // Al abrir, (re)inicializa el formulario con los valores de precarga. Si no hay
  // precarga, arranca en los valores por defecto del alta manual.
  useEffect(() => {
    if (!open) return
    setResultado(null)
    setSeleccionados(initial?.modulos ?? [])
    setSector(initial?.sector ?? '')
    setTarifa(initial?.tarifa ?? 'estandar')
    setCiclo(initial?.ciclo ?? 'mensual')
  }, [open, initial])

  const precioField = tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
  const precioMensual = catalogo
    .filter(m => seleccionados.includes(m.clave))
    .reduce((sum, m) => sum + Number(m[precioField] ?? 0), 0)
  const precioAnual = importeCiclo(precioMensual, 'anual', descuentoAnualPct)
  const ahorroAnual = Math.max(0, precioMensual * 12 - precioAnual)

  const etiquetaCatalogo = plantillas.find(p => p.sector === sector)?.etiquetas?.catalogo
  function nombreModulo(m: ModuloCatalogo): string {
    return m.clave === 'catalogo_qr' && etiquetaCatalogo
      ? m.nombre.replace(/^Catálogo\b/, etiquetaCatalogo)
      : m.nombre
  }

  function toggle(clave: string) {
    setSeleccionados(prev =>
      prev.includes(clave) ? prev.filter(c => c !== clave) : [...prev, clave]
    )
  }

  const handleClose = useCallback(() => {
    const creado = !!resultado
    setResultado(null)
    onClose()
    if (creado) router.refresh()
  }, [resultado, onClose, router])

  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setLoading(true)
    const res = await crearCliente(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error desconocido'); return }
    setResultado({ client_id: res.client_id!, passwordTemporal: res.passwordTemporal!, estado: res.estado! })
  }

  if (!mounted || !open) return null

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-560">
        {resultado ? (
          <div className="modal-body modal-body-success">
            <div className="success-icon-circle">
              <Check size={28} strokeWidth={2.5} />
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
            {resultado.estado === 'TRIAL' ? (
              <div className="alert alert-success">
                <strong>Prueba activa.</strong> El cliente ya puede iniciar sesión en el portal.
                En su primer acceso deberá crear su propia contraseña.
              </div>
            ) : (
              <div className="alert alert-warning">
                <strong>Pendiente de pago.</strong> El cliente puede iniciar sesión, pero verá una
                pantalla de bloqueo hasta que confirmes su primer pago. En su primer acceso deberá
                crear su propia contraseña.
              </div>
            )}
            <button className="btn btn-primary btn-full" onClick={handleClose}>Listo</button>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Nuevo cliente</h2>
              <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            <form ref={formRef} onSubmit={handleSubmit}>
              <div className="modal-body">
                {presupuestoId != null && (
                  <input type="hidden" name="presupuesto_id" value={presupuestoId} />
                )}

                <div className="input-group">
                  <label>Nombre de la empresa <span className="required">*</span></label>
                  <input name="nombre_empresa" className="input" required placeholder="Ej: Empresa Ejemplo S.L." defaultValue={initial?.nombre_empresa ?? ''} />
                </div>

                <div className="grid-cols-2">
                  <div className="input-group">
                    <label>Nombre del contacto</label>
                    <input name="nombre_contacto" className="input" placeholder="Administrador" defaultValue={initial?.nombre_contacto ?? ''} />
                  </div>
                  <div className="input-group">
                    <label>Email del administrador <span className="required">*</span></label>
                    <input name="email_admin" type="email" className="input" required placeholder="admin@empresa.com" defaultValue={initial?.email_admin ?? ''} />
                  </div>
                </div>

                {/* Sector del negocio: preselecciona módulos recomendados y adapta etiquetas */}
                <div className="input-group">
                  <label>Sector del negocio</label>
                  <select name="sector" className="input" value={sector} onChange={e => setSector(e.target.value)}>
                    <option value="">Sin especificar</option>
                    {plantillas.map(p => <option key={p.sector} value={p.sector}>{p.nombre}</option>)}
                  </select>
                  <span className="input-hint">Adapta las etiquetas del negocio (Reservas/Citas, Mesa/Profesional…). No cambia los módulos seleccionados.</span>
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
                              <span className="mod-row-name">{nombreModulo(m)}</span>
                              {m.descripcion && <span className="mod-row-desc">{m.descripcion}</span>}
                            </span>
                            <span className={`mod-row-price${precio === 0 ? ' mod-row-price-free' : ''}`}>
                              {precio > 0 ? `+$${precio.toFixed(2)}` : 'Gratis'}
                            </span>
                            <span className="switch">
                              <input
                                type="checkbox"
                                name="modulos"
                                value={m.clave}
                                checked={activo}
                                onChange={() => toggle(m.clave)}
                                aria-label={`Activar ${nombreModulo(m)}`}
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
                    defaultValue={initial?.pago_setup_usd ?? setupDefault}
                  />
                  <span className="input-hint">Pago único inicial. Pon 0 para omitirlo. Se registra aparte de la suscripción.</span>
                </div>

                <label className="checkbox-group">
                  <input type="checkbox" name="es_trial" value="true" />
                  <span className="checkbox-label">Iniciar con período de prueba gratuita (sin cobro)</span>
                </label>

                <label className="checkbox-group">
                  <input type="checkbox" name="es_prueba" value="true" />
                  <span className="checkbox-label">Cliente de prueba (no cuenta en las estadísticas de CLAUX)</span>
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

  return createPortal(modal, document.body)
}

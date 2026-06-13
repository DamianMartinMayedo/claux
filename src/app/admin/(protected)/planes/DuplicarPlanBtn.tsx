'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearPlan } from '@/app/actions/planes'
import { MODULOS as MODULOS_DEF } from '@/lib/planes-constants'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Plan = {
  plan_id: string; nombre: string; descripcion: string | null
  nivel: string; modalidad: string; precio_usd: number
  duracion_dias: number; dias_trial: number
  max_empresas: number; max_usuarios: number
  modulos: string | string[] | null
  estado: string; visible: boolean
}

function parseModulos(raw: string | string[] | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  return raw.split(',').map(m => m.trim()).filter(Boolean)
}

export default function DuplicarPlanBtn({ plan }: { plan: Plan }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const mounted = useMounted()

  // ── Campos controlados ─────────────────────────────────────────────
  const [nombre,       setNombre]       = useState('')
  const [nivel,        setNivel]        = useState('basico')
  const [modalidad,    setModalidad]    = useState('mensual')
  const [precio,       setPrecio]       = useState('')
  const [duracion,     setDuracion]     = useState('')
  const [diasTrial,    setDiasTrial]    = useState('')
  const [maxEmpresas,  setMaxEmpresas]  = useState('')
  const [maxUsuarios,  setMaxUsuarios]  = useState('')
  const [estado,       setEstado]       = useState('INACTIVO')
  const [visible,      setVisible]      = useState('false')
  const [descripcion,  setDescripcion]  = useState('')
  const [modulosCheck, setModulosCheck] = useState<string[]>([])

  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const handleClose = useCallback(() => { setOpen(false); setError(''); setSuccess(false) }, [])

  useModalKeyboard(open, handleClose)

  function handleOpen() {
    setNombre(`Copia de ${plan.nombre}`)
    setNivel(plan.nivel)
    setModalidad(plan.modalidad)
    setPrecio(String(plan.precio_usd))
    setDuracion(String(plan.duracion_dias))
    setDiasTrial(String(plan.dias_trial ?? 0))
    setMaxEmpresas(String(plan.max_empresas ?? 1))
    setMaxUsuarios(String(plan.max_usuarios ?? 2))
    setEstado('INACTIVO')
    setVisible('false')
    setDescripcion(plan.descripcion ?? '')
    setModulosCheck(parseModulos(plan.modulos))
    setError(''); setSuccess(false)
    setOpen(true)
  }

  function toggleModulo(id: string) {
    setModulosCheck(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)

    // Construir FormData manualmente para incluir módulos y campos controlados
    const fd = new FormData()
    fd.append('nombre',       nombre)
    fd.append('nivel',        nivel)
    fd.append('modalidad',    modalidad)
    fd.append('precio_usd',   precio)
    fd.append('duracion_dias', duracion)
    fd.append('dias_trial',   diasTrial)
    fd.append('max_empresas', maxEmpresas)
    fd.append('max_usuarios', maxUsuarios)
    fd.append('estado',       estado)
    fd.append('visible',      visible)
    fd.append('descripcion',  descripcion)
    modulosCheck.forEach(m => fd.append('modulos', m))

    const res = await crearPlan(fd)
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setSuccess(true)
    setTimeout(() => { handleClose(); router.refresh() }, 1200)
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Duplicar plan</h2>
            <p className="text-xs-muted">
              Copia de «{plan.nombre}» · revisa y guarda para crear el nuevo plan
            </p>
          </div>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Nombre */}
            <div className="input-group">
              <label>Nombre del plan <span className="required">*</span></label>
              <input
                className="input" required
                value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Básico Mensual"
              />
              <span className="text-xs-muted">
                El ID se genera automáticamente según nivel y modalidad (ej: BM002, PT003).
              </span>
            </div>

            {/* Nivel + Modalidad */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Nivel <span className="required">*</span></label>
                <select className="input" required value={nivel} onChange={e => setNivel(e.target.value)}>
                  <option value="basico">Básico</option>
                  <option value="profesional">Profesional</option>
                  <option value="empresarial">Empresarial</option>
                </select>
              </div>
              <div className="input-group">
                <label>Modalidad <span className="required">*</span></label>
                <select className="input" required value={modalidad} onChange={e => setModalidad(e.target.value)}>
                  <option value="mensual">Mensual</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                  <option value="personalizado">Personalizado</option>
                </select>
              </div>
            </div>

            {/* Precio + Duración + Trial */}
            <div className="grid-cols-3">
              <div className="input-group">
                <label>Precio USD <span className="required">*</span></label>
                <input className="input" type="number" step="0.01" min="0" required
                  value={precio} onChange={e => setPrecio(e.target.value)} placeholder="0.00" />
              </div>
              <div className="input-group">
                <label>Duración (días) <span className="required">*</span></label>
                <input className="input" type="number" min="1" required
                  value={duracion} onChange={e => setDuracion(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Días de trial</label>
                <input className="input" type="number" min="0"
                  value={diasTrial} onChange={e => setDiasTrial(e.target.value)} />
              </div>
            </div>

            {/* Capacidad */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Máx. empresas</label>
                <input className="input" type="number" min="1"
                  value={maxEmpresas} onChange={e => setMaxEmpresas(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Máx. usuarios <span className="label-muted-hint">(-1 = ilimitado)</span></label>
                <input className="input" type="number" min="-1"
                  value={maxUsuarios} onChange={e => setMaxUsuarios(e.target.value)} />
              </div>
            </div>

            {/* Módulos */}
            <div>
              <p className="modal-section-label">Módulos incluidos</p>
              <div className="modules-grid">
                {MODULOS_DEF.map(m => (
                  <label key={m.id} className="module-check">
                    <input
                      type="checkbox"
                      checked={modulosCheck.includes(m.id)}
                      onChange={() => toggleModulo(m.id)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Estado + Visible */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Estado</label>
                <select className="input" value={estado} onChange={e => setEstado(e.target.value)}>
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="INACTIVO">INACTIVO</option>
                </select>
              </div>
              <div className="input-group">
                <label>Visible para clientes</label>
                <select className="input" value={visible} onChange={e => setVisible(e.target.value)}>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            {/* Descripción */}
            <div className="input-group">
              <label>Descripción</label>
              <textarea className="input" rows={2}
                value={descripcion} onChange={e => setDescripcion(e.target.value)}
                placeholder="Descripción breve del plan" />
            </div>

            {error   && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">Plan duplicado correctamente</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading || success}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button
        className="btn-icon"
        onClick={handleOpen}
        title={`Duplicar "${plan.nombre}"`}
        aria-label="Duplicar plan"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}

'use client'

import { useState, useTransition, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { guardarEmpresa, subirLogoEmpresa, type Empresa } from '@/app/actions/portal/empresas'

const COLORES = [
  '#00AFAA', '#C97A0C', '#2E7D32', '#1565C0',
  '#6A1B9A', '#AD1457', '#00838F', '#4E342E',
]

interface Moneda { codigo: string; nombre: string; simbolo: string }

interface Props {
  empresas:    Empresa[]
  monedas:     Moneda[]
  maxEmpresas: number | null
  esAdmin:     boolean
}

// Conjunto de letras ya en uso (para feedback inmediato en el modal)
function letrasOcupadas(empresas: Empresa[], excludeId?: string): Set<string> {
  const s = new Set<string>()
  for (const e of empresas) {
    if (e.empresa_id === excludeId) continue
    if (e.letra_facturacion) s.add(e.letra_facturacion.toUpperCase())
  }
  return s
}

// ── Tarjeta ───────────────────────────────────────────────────────────────────

function EmpresaCard({
  empresa, onEditar,
}: { empresa: Empresa; onEditar: (e: Empresa) => void }) {
  const inicial  = empresa.nombre.charAt(0).toUpperCase()
  const esActiva = empresa.estado === 'ACTIVO'
  const color    = empresa.color ?? COLORES[0]

  return (
    <div className="emp-card">
      <div className="emp-card-band" style={{ background: color }} />
      <div className="emp-card-body">
        <div className="emp-card-top">
          <div
            className="emp-avatar-lg"
            style={empresa.logo_url
              ? { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
              : { background: color }}
          >
            {empresa.logo_url
              ? <img src={empresa.logo_url} alt={empresa.nombre} onError={e => {
                  const el = e.currentTarget
                  el.style.display = 'none'
                  el.parentElement!.style.background = color
                  el.parentElement!.textContent = inicial
                }} />
              : inicial}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {empresa.letra_facturacion && (
              <span
                title={`Letra de facturación: ${empresa.letra_facturacion}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: '6px',
                  background: color,
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '13px',
                  letterSpacing: '0.02em',
                }}
              >
                {empresa.letra_facturacion}
              </span>
            )}
            <span className={`emp-card-estado ${esActiva ? 'emp-estado-activo' : 'emp-estado-inactivo'}`}>
              {esActiva ? 'Activa' : 'Inactiva'}
            </span>
          </div>
        </div>

        <div className="emp-card-nombre" title={empresa.nombre}>{empresa.nombre}</div>
        <div className="emp-card-fiscal">
          {[empresa.nombre_fiscal, empresa.rif_nit ? `NIF/NIT: ${empresa.rif_nit}` : null]
            .filter(Boolean).join(' · ')}
        </div>

        <div className="emp-card-meta">
          {(empresa.ciudad || empresa.pais) && (
            <div className="emp-meta-row">
              <IconLocation />
              {[empresa.ciudad, empresa.pais].filter(Boolean).join(', ')}
            </div>
          )}
          {empresa.email && (
            <div className="emp-meta-row">
              <IconMail />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{empresa.email}</span>
            </div>
          )}
          {empresa.moneda_funcional && (
            <div className="emp-meta-row">
              <IconCoin />
              Moneda: <strong>{empresa.moneda_funcional}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="emp-card-footer">
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => onEditar(empresa)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Editar
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalState {
  open:    boolean
  empresa: Empresa | null
}

function EmpresaModal({
  state, monedas, empresas, onClose, onSaved,
}: {
  state:    ModalState
  monedas:  Moneda[]
  empresas: Empresa[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error,       setError]       = useState('')
  const [color,       setColor]       = useState(state.empresa?.color ?? COLORES[0])
  const [letra,       setLetra]       = useState((state.empresa?.letra_facturacion ?? '').toUpperCase())
  const [mostrarLogo, setMostrarLogo] = useState(state.empresa?.mostrar_logo ?? true)
  const [logoPreview, setLogoPreview] = useState<string | null>(state.empresa?.logo_url ?? null)
  const [logoFile,    setLogoFile]    = useState<File | null>(null)
  const [logoNombre,  setLogoNombre]  = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const esEdicion = !!state.empresa
  const ocupadas  = letrasOcupadas(empresas, state.empresa?.empresa_id)
  const letraDuplicada = !!letra && ocupadas.has(letra)

  const resetLogo = useCallback(() => {
    setLogoPreview(state.empresa?.logo_url ?? null)
    setLogoFile(null)
    setLogoNombre('')
  }, [state.empresa])

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError('El logo no puede superar 2 MB.')
      return
    }
    setLogoFile(file)
    setLogoNombre(file.name)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    if (letraDuplicada) {
      setError(`La letra "${letra}" ya está asignada a otra empresa. Elige una distinta.`)
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set('color', color)
    fd.set('letra_facturacion', letra)
    fd.set('mostrar_logo', String(mostrarLogo))

    startTransition(async () => {
      const result = await guardarEmpresa(fd)
      if (!result.ok) { setError(result.error ?? 'Error inesperado.'); return }

      // Subir logo si hay uno nuevo
      if (logoFile && result.empresa_id) {
        const logoFd = new FormData()
        logoFd.set('empresa_id', result.empresa_id)
        logoFd.set('logo', logoFile)
        const logoResult = await subirLogoEmpresa(logoFd)
        if (!logoResult.ok) {
          setError(`Empresa guardada, pero el logo no se pudo subir: ${logoResult.error}`)
          onSaved()
          return
        }
      }

      onSaved()
    })
  }

  if (!state.open) return null

  return (
    <div className="modal-backdrop open">
      <div className="modal" style={{ maxWidth: 600 }} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar empresa' : 'Nueva empresa'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: 'var(--space-5) var(--space-6)' }}>
            {state.empresa && <input type="hidden" name="empresa_id" value={state.empresa.empresa_id} />}

            <div className="emp-form-grid">

              <div className="input-group">
                <label>Nombre comercial <span className="required">*</span></label>
                <input className="input" name="nombre" defaultValue={state.empresa?.nombre ?? ''} placeholder="Como aparece en documentos" required />
              </div>

              <div className="input-group">
                <label>Nombre fiscal / Razón social</label>
                <input className="input" name="nombre_fiscal" defaultValue={state.empresa?.nombre_fiscal ?? ''} placeholder="Nombre legal completo" />
              </div>

              <div className="input-group">
                <label>NIF / NIT</label>
                <input className="input" name="rif_nit" defaultValue={state.empresa?.rif_nit ?? ''} placeholder="Ej: B-12345678" />
                <span className="input-hint">Número de Identificación Fiscal o Tributaria</span>
              </div>

              <div className="input-group">
                <label>Moneda funcional</label>
                <select className="input" name="moneda_funcional" defaultValue={state.empresa?.moneda_funcional ?? ''}>
                  <option value="">Sin especificar</option>
                  {monedas.map(m => (
                    <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.nombre}</option>
                  ))}
                </select>
                <span className="input-hint">Moneda principal de operación de esta empresa</span>
              </div>

              <div className="input-group">
                <label>País</label>
                <input className="input" name="pais" defaultValue={state.empresa?.pais ?? ''} placeholder="Ej: Cuba, España" />
              </div>

              <div className="input-group">
                <label>Ciudad</label>
                <input className="input" name="ciudad" defaultValue={state.empresa?.ciudad ?? ''} placeholder="Ej: La Habana" />
              </div>

              <div className="input-group emp-full">
                <label>Dirección</label>
                <input className="input" name="direccion" defaultValue={state.empresa?.direccion ?? ''} placeholder="Calle, número, municipio" />
              </div>

              <div className="input-group">
                <label>Teléfono</label>
                <input className="input" name="telefono" defaultValue={state.empresa?.telefono ?? ''} placeholder="+53 5 123 4567" />
              </div>

              <div className="input-group">
                <label>Email</label>
                <input className="input" type="email" name="email" defaultValue={state.empresa?.email ?? ''} placeholder="empresa@correo.com" />
              </div>

              {/* Letra de facturación */}
              <div className="input-group emp-full">
                <label>Letra de facturación</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    className="input"
                    style={{
                      width: 80,
                      textAlign: 'center',
                      fontSize: '18px',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      borderColor: letraDuplicada ? 'var(--color-error)' : undefined,
                    }}
                    maxLength={1}
                    value={letra}
                    onChange={e => setLetra(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                    placeholder="—"
                  />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Identifica esta empresa en los consecutivos de ofertas y facturas.<br />
                    Ej: letra <strong>M</strong> → facturas <strong>FM20260001</strong>, ofertas <strong>OFM20260001</strong>.
                  </span>
                </div>
                {letraDuplicada && (
                  <span className="input-hint" style={{ color: 'var(--color-error)' }}>
                    Esta letra ya está en uso por otra empresa.
                  </span>
                )}
                {ocupadas.size > 0 && !letraDuplicada && (
                  <span className="input-hint">
                    Letras ya asignadas: {[...ocupadas].sort().join(', ')}
                  </span>
                )}
              </div>

              {/* Paleta de colores */}
              <div className="input-group emp-full">
                <label>Color de identificación</label>
                <div className="color-picker">
                  {COLORES.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch${color === c ? ' selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      aria-label={c}
                      title={c}
                    />
                  ))}
                </div>
                <span className="input-hint">Se usa para distinguir esta empresa en listas y documentos</span>
              </div>

              {/* Upload logo */}
              <div className="input-group emp-full">
                <label>Logo de la empresa</label>
                <div
                  className="logo-upload-area"
                  onClick={() => fileRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
                >
                  <div className="logo-upload-preview">
                    {logoPreview
                      ? <img src={logoPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 22, height: 22, color: 'var(--color-text-muted)' }}>
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>}
                  </div>
                  <div className="logo-upload-info">
                    <strong>Haz clic para subir el logo</strong>
                    <span>PNG, JPG o WebP · Máx. 2 MB · Fondo transparente recomendado</span>
                    {logoNombre && <span style={{ color: 'var(--color-primary)', fontWeight: 600, marginTop: 'var(--space-1)', display: 'block' }}>{logoNombre}</span>}
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleLogoChange}
                />
                {(logoPreview || (esEdicion && state.empresa?.logo_url)) && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={mostrarLogo}
                      onChange={e => setMostrarLogo(e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                      Mostrar logo en documentos PDF
                    </span>
                  </label>
                )}
              </div>

              {/* Estado — solo en edición */}
              {esEdicion && (
                <div className="input-group emp-full">
                  <label>Estado</label>
                  <select className="input" name="estado" defaultValue={state.empresa?.estado ?? 'ACTIVO'}>
                    <option value="ACTIVO">Activa</option>
                    <option value="INACTIVO">Inactiva</option>
                  </select>
                </div>
              )}

            </div>

            {error && <div className="alert alert-error" style={{ marginTop: 'var(--space-4)' }}>{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} />{esEdicion ? 'Guardando…' : 'Creando…'}</>
                : esEdicion ? 'Guardar cambios' : 'Crear empresa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Grid principal ────────────────────────────────────────────────────────────

export default function EmpresasGrid({ empresas: init, monedas, maxEmpresas, esAdmin }: Props) {
  const router = useRouter()
  const [modal, setModal] = useState<ModalState>({ open: false, empresa: null })
  const limiteAlcanzado   = maxEmpresas !== null && init.length >= maxEmpresas

  function abrirCrear() {
    if (limiteAlcanzado) return
    setModal({ open: true, empresa: null })
  }

  function abrirEditar(empresa: Empresa) {
    setModal({ open: true, empresa })
  }

  function cerrar() {
    setModal({ open: false, empresa: null })
  }

  function onSaved() {
    cerrar()
    router.refresh()
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis empresas</h1>
          <p className="page-subtitle">
            Gestiona los datos fiscales y configuración de cada empresa.
            {maxEmpresas !== null && (
              <span style={{ marginLeft: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
                {init.length} / {maxEmpresas} empresas
              </span>
            )}
          </p>
        </div>
        {esAdmin && (
          <button
            className="btn btn-primary"
            onClick={abrirCrear}
            disabled={limiteAlcanzado}
            title={limiteAlcanzado ? `Límite de ${maxEmpresas} empresa${maxEmpresas === 1 ? '' : 's'} alcanzado` : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Nueva empresa
          </button>
        )}
      </div>

      {limiteAlcanzado && esAdmin && (
        <div className="alert alert-warning" style={{ marginBottom: 'var(--space-5)' }}>
          Has alcanzado el límite de <strong>{maxEmpresas}</strong> empresa{maxEmpresas === 1 ? '' : 's'} de tu plan. Actualiza tu suscripción para añadir más.
        </div>
      )}

      <div className="emp-grid">
        {init.map(emp => (
          <EmpresaCard key={emp.empresa_id} empresa={emp} onEditar={abrirEditar} />
        ))}

        {esAdmin && !limiteAlcanzado && (
          <button className="emp-card-add" onClick={abrirCrear}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Nueva empresa</span>
          </button>
        )}

        {init.length === 0 && (
          <div className="emp-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
            </svg>
            <h3>Sin empresas configuradas</h3>
            <p>Crea tu primera empresa para empezar a registrar operaciones.</p>
          </div>
        )}
      </div>

      <EmpresaModal
        key={modal.empresa?.empresa_id ?? 'nueva'}
        state={modal}
        monedas={monedas}
        empresas={init}
        onClose={cerrar}
        onSaved={onSaved}
      />
    </div>
  )
}

// ── Mini-iconos de meta ───────────────────────────────────────────────────────
function IconLocation() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
}
function IconMail() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, flexShrink: 0 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
}
function IconCoin() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
}

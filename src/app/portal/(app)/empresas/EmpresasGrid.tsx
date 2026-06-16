'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { guardarEmpresa, subirLogoEmpresa, type Empresa } from '@/app/actions/portal/empresas'
import { Briefcase, Coins, Image as ImageIcon, Mail, MapPin, Pencil, Plus, X } from 'lucide-react'
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
          {empresa.logo_url
            ? (
              <div className="emp-avatar-lg emp-avatar-with-logo">
                <Image src={empresa.logo_url} alt={empresa.nombre} width={48} height={48} onError={e => {
                  const el = e.currentTarget
                  el.style.display = 'none'
                  el.parentElement!.style.background = color
                  el.parentElement!.textContent = inicial
                }} />
              </div>
            )
            : <div className="emp-avatar-lg" style={{ background: color }}>{inicial}</div>
          }
          <div className="emp-card-top-right">
            {empresa.letra_facturacion && (
              <span
                className="emp-letra-badge"
                title={`Letra de facturación: ${empresa.letra_facturacion}`}
                style={{ background: color }}
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
              <MapPin size={12} strokeWidth={2} />
              {[empresa.ciudad, empresa.pais].filter(Boolean).join(', ')}
            </div>
          )}
          {empresa.email && (
            <div className="emp-meta-row">
              <Mail size={12} strokeWidth={2} />
              <span className="text-truncate">{empresa.email}</span>
            </div>
          )}
          {empresa.moneda_funcional && (
            <div className="emp-meta-row">
              <Coins size={12} strokeWidth={2} />
              Moneda: <strong>{empresa.moneda_funcional}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="emp-card-footer">
        <button className="btn btn-secondary btn-sm flex-1" onClick={() => onEditar(empresa)}>
          <Pencil size={13} />
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

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toastError('El logo no puede superar 2 MB.')
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
    if (letraDuplicada) {
      toastError(`La letra "${letra}" ya está asignada a otra empresa. Elige una distinta.`)
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set('color', color)
    fd.set('letra_facturacion', letra)
    fd.set('mostrar_logo', String(mostrarLogo))

    startTransition(async () => {
      const result = await guardarEmpresa(fd)
      if (!result.ok) { toastError(result.error ?? 'Error inesperado.'); return }

      if (logoFile && result.empresa_id) {
        const logoFd = new FormData()
        logoFd.set('empresa_id', result.empresa_id)
        logoFd.set('logo', logoFile)
        const logoResult = await subirLogoEmpresa(logoFd)
        if (!logoResult.ok) {
          toastError(`Empresa guardada, pero el logo no se pudo subir: ${logoResult.error}`)
          onSaved()
          return
        }
      }

      onSaved()
    })
  }

  if (!state.open) return null

  return (
    <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar empresa' : 'Nueva empresa'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body modal-body-wide">
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
                <div className="emp-letra-input-row">
                  <input
                    className="input emp-letra-input"
                    style={{ borderColor: letraDuplicada ? 'var(--color-error)' : undefined }}
                    maxLength={1}
                    value={letra}
                    onChange={e => setLetra(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                    placeholder="—"
                  />
                  <span className="emp-letra-hint">
                    Identifica esta empresa en los consecutivos de ofertas y facturas.<br />
                    Ej: letra <strong>M</strong> → facturas <strong>FM20260001</strong>, ofertas <strong>OFM20260001</strong>.
                  </span>
                </div>
                {letraDuplicada && (
                  <span className="input-hint input-hint-danger">
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
                      ? <Image src={logoPreview} alt="Preview" width={56} height={56} unoptimized />
                      : <ImageIcon size={22} strokeWidth={1.5} className="text-muted" />}
                  </div>
                  <div className="logo-upload-info">
                    <strong>Haz clic para subir el logo</strong>
                    <span>PNG, JPG o WebP · Máx. 2 MB · Fondo transparente recomendado</span>
                    {logoNombre && <span className="logo-filename">{logoNombre}</span>}
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                {(logoPreview || (esEdicion && state.empresa?.logo_url)) && (
                  <label className="emp-logo-toggle">
                    <input
                      type="checkbox"
                      checked={mostrarLogo}
                      onChange={e => setMostrarLogo(e.target.checked)}
                      className="emp-logo-checkbox"
                    />
                    <span className="text-sm-muted">
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

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" />{esEdicion ? 'Guardando…' : 'Creando…'}</>
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
              <span className="emp-plan-count">
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
            <Plus size={16} />
            Nueva empresa
          </button>
        )}
      </div>

      {limiteAlcanzado && esAdmin && (
        <div className="alert alert-warning mb-5">
          Has alcanzado el límite de <strong>{maxEmpresas}</strong> empresa{maxEmpresas === 1 ? '' : 's'} de tu plan. Actualiza tu suscripción para añadir más.
        </div>
      )}

      <div className="emp-grid">
        {init.map(emp => (
          <EmpresaCard key={emp.empresa_id} empresa={emp} onEditar={abrirEditar} />
        ))}

        {esAdmin && !limiteAlcanzado && (
          <button className="emp-card-add" onClick={abrirCrear}>
            <Plus size={28} strokeWidth={1.5} />
            <span className="text-sm-bold">Nueva empresa</span>
          </button>
        )}

        {init.length === 0 && (
          <div className="emp-empty">
            <Briefcase size={48} strokeWidth={1} />
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


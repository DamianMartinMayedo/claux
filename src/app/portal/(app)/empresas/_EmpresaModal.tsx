'use client'

// Modal de empresa: crear y editar, con color, logo y LETRA de facturación. Vive
// aparte de `EmpresasGrid` porque lo abren DOS pantallas —la de Empresas y la guía
// de puesta en marcha del dashboard—, y ahí es el formulario entero el que se pinta:
// una empresa a medias es justo lo que la guía existe para evitar.

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { guardarEmpresa, subirLogoEmpresa, type Empresa } from '@/app/actions/portal/empresas'
import { Image as ImageIcon, Plus } from 'lucide-react'
import FormHelp from '@/components/portal/FormHelp'
import ModalShell from '@/components/portal/ModalShell'
import { empresaColorVar } from '@/components/portal/EmpresaTag'
import { COLORES_EMPRESA } from '@/lib/colores-empresa'

// La paleta vive en `lib/colores-empresa`: la comparten la validación del
// servidor (`guardarEmpresa`) y esta pantalla.
const COLORES = COLORES_EMPRESA

export interface MonedaOpcionEmpresa { codigo: string; nombre: string; simbolo: string }

function letrasOcupadas(empresas: Empresa[], excludeId?: string): Set<string> {
  const s = new Set<string>()
  for (const e of empresas) {
    if (e.empresa_id === excludeId) continue
    if (e.letra_facturacion) s.add(e.letra_facturacion.toUpperCase())
  }
  return s
}

export interface ModalState {
  open:    boolean
  empresa: Empresa | null
}

export default function EmpresaModal({
  state, monedas, empresas, enfocar, onClose, onSaved,
}: {
  state:    ModalState
  monedas:  MonedaOpcionEmpresa[]
  empresas: Empresa[]
  /**
   * Campo al que se viene. Lo usa el paso «Asigna la letra» de la puesta en
   * marcha: abre esta misma ficha en edición y la letra vive abajo del todo,
   * entre el email y los textos de factura, así que sin esto el dueño aterriza en
   * un formulario lleno sin saber qué venía a tocar. Con esto se le lleva al
   * campo, se le resalta y **ahí sí es obligatorio**: es lo único que ha venido a
   * hacer. Obligatorio solo aquí, nunca en la página de Empresas — un cliente sin
   * el módulo de facturación no necesita ninguna letra, y exigirla bloquearía
   * guardar una ficha por algo que no le hace falta.
   */
  enfocar?: 'letra'
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
  const fileRef  = useRef<HTMLInputElement>(null)
  const formRef  = useRef<HTMLFormElement>(null)
  const letraRef = useRef<HTMLInputElement>(null)

  // Se lleva al campo en cuanto el modal está en pantalla. `preventScroll` porque
  // el desplazamiento lo hace `scrollIntoView`, que lo deja centrado: el del foco
  // a secas lo pega al borde y el campo queda medio tapado por el pie del modal.
  const pedirLetra = enfocar === 'letra'
  useEffect(() => {
    if (!pedirLetra) return
    const el = letraRef.current
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
  }, [pedirLetra])

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

    const ld = toastLoading(esEdicion ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const result = await guardarEmpresa(fd)
      if (!result.ok) { await ld.dismiss(); toastError(result.error ?? 'Error inesperado.'); return }

      if (logoFile && result.empresa_id) {
        const logoFd = new FormData()
        logoFd.set('empresa_id', result.empresa_id)
        logoFd.set('logo', logoFile)
        const logoResult = await subirLogoEmpresa(logoFd)
        if (!logoResult.ok) {
          await ld.dismiss()
          toastError(`Empresa guardada, pero el logo no se pudo subir: ${logoResult.error}`)
          onSaved()
          return
        }
      }

      await ld.dismiss()
      onSaved()
    })
  }

  if (!state.open) return null

  return (
    <ModalShell title={esEdicion ? 'Editar empresa' : 'Nueva empresa'} onClose={onClose} size="modal-lg">
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
                <div className="form-label-with-help">
                  <label>NIF / NIT</label>
                  <FormHelp text="Número de Identificación Fiscal o Tributaria." label="Qué es el NIF / NIT" />
                </div>
                <input className="input" name="rif_nit" defaultValue={state.empresa?.rif_nit ?? ''} placeholder="Ej: B-12345678" />
              </div>

              {/* La moneda funcional es NOT NULL en base de datos, pero el formulario la
                  ofrecía como «Sin especificar»: al guardar vacío llegaba un null explícito
                  —que no toma el default de la columna— y saltaba un error de Postgres sin
                  traducir. Se marca obligatoria, que es lo que siempre fue. */}
              <div className="input-group">
                <div className="form-label-with-help">
                  <label>Moneda funcional <span className="required">*</span></label>
                  {esEdicion && (
                    <FormHelp
                      text="Cuidado: si esta empresa ya tiene operaciones registradas, cambiar su moneda funcional puede descuadrar informes y saldos ya calculados. Cámbiala solo si sabes lo que haces."
                      label="Qué pasa si cambio la moneda funcional"
                    />
                  )}
                </div>
                {monedas.length === 0 ? (
                  <div className="prd-almacen-req">
                    <p className="input-hint">
                      Toda empresa opera en una moneda, y todavía no tienes ninguna configurada.
                    </p>
                    <Link href="/portal/monedas" className="btn btn-primary btn-sm">
                      <Plus size={14} strokeWidth={2.5} /> Añadir una moneda
                    </Link>
                  </div>
                ) : (
                  <>
                    <select className="input" name="moneda_funcional" required
                      defaultValue={state.empresa?.moneda_funcional ?? ''}>
                      {/* value="" + disabled + required: el navegador para el envío aquí
                          en vez de dejar pasar un vacío que revienta más adelante. */}
                      <option value="" disabled>Elige una moneda</option>
                      {monedas.map(m => (
                        <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.nombre}</option>
                      ))}
                    </select>
                    <span className="input-hint">
                      Moneda principal de operación de esta empresa. ¿No ves la tuya?{' '}
                      <Link href="/portal/monedas" className="link-primary">Añádela en Monedas y tasas</Link>.
                    </span>
                  </>
                )}
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
              <div className={`input-group emp-full${pedirLetra ? ' emp-letra-senalada' : ''}`}>
                <label>Letra de facturación {pedirLetra && <span className="required">*</span>}</label>
                <div className="emp-letra-input-row">
                  <input
                    ref={letraRef}
                    className={`input emp-letra-input${letraDuplicada ? ' is-invalid' : ''}`}
                    maxLength={1}
                    value={letra}
                    onChange={e => setLetra(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                    placeholder="—"
                    required={pedirLetra}
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

              {/* Textos de facturación (mig. 151). Van en la empresa y no en cada
                  documento porque son estables: el dueño los estaba copiando en las notas
                  de cada factura, a mano, cada vez. */}
              <div className="input-group emp-full">
                <div className="form-label-with-help">
                  <label htmlFor="emp-datos-pago">Cómo te pagan</label>
                  <FormHelp text="Sale en tus facturas bajo «Cómo pagar». Si lo dejas vacío, ese bloque no se imprime." label="Dónde aparecen los datos de pago" />
                </div>
                <textarea
                  id="emp-datos-pago"
                  className="input input-textarea"
                  name="datos_pago"
                  rows={3}
                  defaultValue={state.empresa?.datos_pago ?? ''}
                  placeholder={'Tarjeta 9224 0699 1234 5678 (MLC)\nEnzona / Transfermóvil: +53 5 123 4567\nBanco Metropolitano, cuenta 1234...'}
                />
              </div>

              <div className="input-group emp-full">
                <div className="form-label-with-help">
                  <label htmlFor="emp-pie-factura">Pie de factura</label>
                  <FormHelp text="Texto fijo al final de todas tus facturas." label="Qué es el pie de factura" />
                </div>
                <textarea
                  id="emp-pie-factura"
                  className="input input-textarea"
                  name="pie_factura"
                  rows={2}
                  defaultValue={state.empresa?.pie_factura ?? ''}
                  placeholder="Gracias por su confianza · Licencia de operaciones nº…"
                />
              </div>

              {/* Paleta de colores */}
              <div className="input-group emp-full">
                <div className="form-label-with-help">
                  <label>Color de identificación</label>
                  <FormHelp text="Se usa para distinguir esta empresa en listas y documentos." label="Para qué sirve el color" />
                </div>
                <div className="color-picker">
                  {COLORES.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch${color === c ? ' selected' : ''}`}
                      style={empresaColorVar(c)}
                      onClick={() => setColor(c)}
                      aria-label={c}
                      title={c}
                    />
                  ))}
                </div>
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
    </ModalShell>
  )
}

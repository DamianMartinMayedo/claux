'use client'

import { Check, X } from 'lucide-react'
import { toastError } from '@/app/contexts/ToastContext'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
import type { ParametrosPresupuesto } from '@/lib/presupuesto/config'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearCliente } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import FormHelp from '@/components/portal/FormHelp'
import { useMounted } from '@/lib/use-mounted'
import { importeCiclo } from '@/lib/billing'
import { NIVELES, precioModulo, type Nivel } from '@/lib/niveles'
import { MIGRACION_ESTADOS_ALTA, MIGRACION_ESTADO_LABEL } from '@/lib/migracion'

export type ModuloCatalogo = {
  clave: string
  nombre: string
  descripcion: string | null
  precio_inicial_usd: number
  precio_empresa_usd: number
  precio_pro_usd: number
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
  nivel?:           Nivel
  ciclo?:           'mensual' | 'anual'
  modulos?:         string[]
  pago_setup_usd?:  number
}

type Props = {
  open:              boolean
  onClose:           () => void
  catalogo:          ModuloCatalogo[]
  plantillas:        PlantillaSector[]
  /** Cómo se llama hoy cada nivel (`niveles.nombre`, editable desde /admin). */
  nombresNivel:      Record<Nivel, string>
  descuentoAnualPct: number
  /** Precios del presupuesto de instalación, para estimar el pago de configuración. */
  parametros?:       ParametrosPresupuesto
  initial?:          InitialCliente
  presupuestoId?:    number
}

const GRUPOS: { label: string; tipo: string }[] = [
  { label: 'Módulos',         tipo: 'modulo' },
  { label: 'Funcionalidades', tipo: 'funcionalidad' },
  { label: 'Addons',          tipo: 'addon' },
]

export default function ClienteFormModal({
  open, onClose, catalogo, plantillas, nombresNivel, descuentoAnualPct, parametros, initial, presupuestoId,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<{ client_id: string; passwordTemporal: string; estado: string; email?: string } | null>(null)
  const mounted = useMounted()
  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const [seleccionados, setSeleccionados] = useState<string[]>([])
  const [sector, setSector] = useState('')
  const [nivel, setNivel] = useState<Nivel>('inicial')
  const [ciclo, setCiclo]   = useState<'mensual' | 'anual'>('mensual')
  // Va arriba del todo y en estado (no `defaultChecked`) porque decide qué se
  // muestra del resto: a un entorno de prueba no se le cobra, así que nivel,
  // ciclo, precio y pago de configuración no pintan nada y solo son campos que
  // rellenar. Los ocultos no se envían, y `crearCliente` los ignora igualmente.
  const [esPrueba, setEsPrueba] = useState(false)
  // Controlado porque el botón de estimar lo rellena: con `defaultValue` no había forma de
  // escribir en él desde fuera.
  const [pagoSetup, setPagoSetup] = useState('')

  // Al abrir, (re)inicializa el formulario con los valores de precarga. Si no hay
  // precarga, arranca en los valores por defecto del alta manual.
  useEffect(() => {
    if (!open) return
    setResultado(null)
    setSeleccionados(initial?.modulos ?? [])
    setSector(initial?.sector ?? '')
    setNivel(initial?.nivel ?? 'inicial')
    setCiclo(initial?.ciclo ?? 'mensual')
    setEsPrueba(false)
    setPagoSetup(initial?.pago_setup_usd != null ? String(initial.pago_setup_usd) : '')
  }, [open, initial])

  /**
   * Estimación del pago de configuración con los módulos que se están marcando.
   *
   * El alta manual pedía el importe a pelo —antes con un defecto de $1.000 que no salía de
   * ningún cálculo—. Aquí se usa el MISMO motor que el presupuesto, con volúmenes en blanco:
   * da el suelo por módulos, que es lo que necesita un alta rápida. Para cotizar con volúmenes
   * y descuento está la calculadora entera, enlazada al lado.
   */
  const estimacion = useMemo(() => {
    if (!parametros || seleccionados.length === 0) return null
    return calcularInstalacion(
      { modulos: seleccionados, volumenes: {}, formato: 'cero' },
      parametros,
    )
  }, [parametros, seleccionados])

  const precioMensual = catalogo
    .filter(m => seleccionados.includes(m.clave))
    .reduce((sum, m) => sum + precioModulo(m, nivel), 0)
  const precioAnual = importeCiclo(precioMensual, 'anual', descuentoAnualPct)
  const ahorroAnual = Math.max(0, precioMensual * 12 - precioAnual)

  const etiquetaCatalogo = plantillas.find(p => p.sector === sector)?.etiquetas?.catalogo
  // El catálogo se nombra según el sector: un restaurante ve «Menú digital»; una
  // tienda, «Catálogo digital». Se COMPONE en vez de parchear `m.nombre`: antes
  // era un replace sobre /^Catálogo\b/, así que renombrar el módulo desde el
  // admin lo rompía en silencio (y al pasar a «Menú/catálogo digital» dejó de
  // aplicar). Así el nombre del catálogo puede cambiar sin tocar esto.
  function nombreModulo(m: ModuloCatalogo): string {
    return m.clave === 'catalogo_qr' && etiquetaCatalogo
      ? `${etiquetaCatalogo} digital`
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

  /**
   * Lleva a la calculadora con lo que ya está escrito en este formulario.
   *
   * El cliente todavía no existe —estamos creándolo—, así que no hay `client_id` que pasar:
   * viajan los datos tecleados. Al aprobar ese presupuesto se crea el cliente desde él, que
   * es el camino normal, y el enlace queda hecho por `client_id` como en cualquier otro.
   */
  function urlPresupuesto(): string {
    const q = new URLSearchParams()
    const nombre = (formRef.current?.querySelector('[name="nombre_empresa"]') as HTMLInputElement | null)?.value?.trim()
    const contacto = (formRef.current?.querySelector('[name="nombre_contacto"]') as HTMLInputElement | null)?.value?.trim()
    const email = (formRef.current?.querySelector('[name="email_admin"]') as HTMLInputElement | null)?.value?.trim()
    if (nombre)   q.set('negocio', nombre)
    if (contacto) q.set('responsable', contacto)
    if (email)    q.set('contacto', email)
    if (seleccionados.length > 0) q.set('modulos', seleccionados.join(','))
    q.set('nivel', nivel)
    return `/admin/presupuestos/nuevo?${q.toString()}`
  }

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
              {/* El correo se enseña SIEMPRE, no solo cuando se le ha puesto sufijo:
                  es el usuario con el que se inicia sesión, y en los de prueba puede
                  no ser el que se tecleó (ver `emailConSufijo` en actions/clientes). */}
              {resultado.email && (
                <div className="code-block-field">
                  <label className="code-block-label">Usuario (correo)</label>
                  <p className="code-block-value code-block-value-text">{resultado.email}</p>
                </div>
              )}
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

                {/* Lo primero: decide la mitad del formulario. */}
                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    name="es_prueba"
                    value="true"
                    checked={esPrueba}
                    onChange={e => setEsPrueba(e.target.checked)}
                  />
                  <span className="checkbox-label">
                    Cliente de prueba — entorno interno, sin cobros ni caducidad
                    <span className="input-hint">
                      No cuenta en las estadísticas de CLAUX. Se crea en prueba permanente:
                      no se le registra ningún cobro y no vence nunca.
                    </span>
                  </span>
                </label>

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
                  <div className="form-label-with-help">
                    <label>Sector del negocio</label>
                    <FormHelp text="Adapta las etiquetas del negocio (Reservas/Citas, Mesa/Profesional…). No cambia los módulos seleccionados." label="Qué hace el sector" />
                  </div>
                  <select name="sector" className="input" value={sector} onChange={e => setSector(e.target.value)}>
                    <option value="">Sin especificar</option>
                    {plantillas.map(p => <option key={p.sector} value={p.sector}>{p.nombre}</option>)}
                  </select>
                </div>

                {/* Nivel: fija a la vez el precio de cada módulo y cuánto cabe dentro. */}
                {!esPrueba && (
                <div className="seg-field">
                  <span className="seg-field-label">Nivel</span>
                  <div className="seg">
                    {NIVELES.map(n => (
                      <label key={n} className="seg-opt">
                        <input type="radio" name="nivel" value={n} checked={nivel === n}
                          onChange={() => setNivel(n)} />
                        <span>{nombresNivel[n]}</span>
                      </label>
                    ))}
                  </div>
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

                {/* Cobro: nada de esto aplica a un entorno de prueba. */}
                {!esPrueba && (
                <>
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
                {/* Sin importe por defecto. Había un ajuste global de $1.000 que se
                    prerellenaba aquí, y para el mismo cliente el presupuesto calculaba otra
                    cifra: dos precios para el mismo concepto. Viniendo de un presupuesto
                    llega su total; en un alta manual se escribe, y se dice que ese importe
                    no tiene horas detrás con las que contrastarlo. */}
                <div className="input-group">
                  <div className="form-label-with-help">
                    <label>Pago de configuración (USD)</label>
                    <FormHelp
                      text={presupuestoId
                        ? 'Viene del presupuesto aprobado. Cambiarlo aquí lo separa de las horas cotizadas.'
                        : 'Pago único inicial. Déjalo vacío para omitirlo. La estimación no cuenta volúmenes ni descuentos: para eso, un presupuesto — se le puede hacer luego desde su ficha y queda enlazado.'}
                      label="Información sobre el pago de configuración" />
                  </div>
                  <input
                    name="pago_setup_usd"
                    type="number"
                    min="0"
                    step="any"
                    className="input"
                    value={pagoSetup}
                    onChange={e => setPagoSetup(e.target.value)}
                    placeholder="0"
                  />
                  {/* Dos caminos, y ninguno es inventarse la cifra:
                      · la cuenta rápida con los módulos ya marcados, para un alta sin más;
                      · o irse a cotizarlo en serio —volúmenes, nivel pactado, descuento—
                        llevándose lo que ya se ha tecleado aquí. Es el camino inverso al
                        habitual (presupuesto → cliente) y es igual de legítimo: a veces el
                        cliente aparece primero y el presupuesto se hace después. */}
                  {!presupuestoId && estimacion && (
                    <p className="cli-estimacion">
                      <span>
                        Por sus módulos: <strong>{estimacion.horasTotal}h</strong> ·{' '}
                        <strong>${estimacion.costeInstalacionUsd.toFixed(2)}</strong>
                      </span>
                      <span className="cli-estimacion-acciones">
                        <button type="button" className="btn btn-secondary btn-xs"
                          onClick={() => setPagoSetup(estimacion.costeInstalacionUsd.toFixed(2))}>
                          Usar este importe
                        </button>
                        {/* Botón y no enlace: la URL se arma AL PULSAR, leyendo el
                            formulario en ese momento. Calculándola en el render salía con lo
                            que hubiera antes de teclear —los campos son no controlados— y el
                            comercial llegaba a la calculadora con el negocio en blanco. */}
                        <button type="button" className="btn btn-ghost btn-xs"
                          onClick={() => router.push(urlPresupuesto())}>
                          Hacer presupuesto
                        </button>
                      </span>
                    </p>
                  )}
                </div>

                {/* Marcada por defecto: el alta normal empieza con prueba gratuita.
                    Desmarcarla es decir «este ya paga», y entonces nace bloqueado
                    hasta que confirmes su primer cobro. */}
                <label className="checkbox-group">
                  <input type="checkbox" name="es_trial" value="true" defaultChecked />
                  <span className="checkbox-label">Iniciar con período de prueba gratuita (sin cobro)</span>
                </label>
                </>
                )}

                {/* Datos de un sistema anterior → migracion_estado. Gobierna el aviso de
                    bienvenida y si el cliente ve la herramienta para importar. Editable
                    luego en la ficha. `completada` no es opción de alta (se alcanza al
                    terminar la migración). */}
                <div className="input-group">
                  <div className="form-label-with-help">
                    <label>Datos de un sistema anterior</label>
                    <FormHelp text="¿El negocio trae datos de otro sistema y quién los migra? Decide el aviso de bienvenida y si el cliente ve la herramienta para importar sus datos. Se puede cambiar luego en la ficha." label="Qué decide esta pregunta" />
                  </div>
                  <select name="migracion_estado" className="input" defaultValue="sin_datos_previos">
                    {MIGRACION_ESTADOS_ALTA.map(e => (
                      <option key={e} value={e}>{MIGRACION_ESTADO_LABEL[e]}</option>
                    ))}
                  </select>
                </div>

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

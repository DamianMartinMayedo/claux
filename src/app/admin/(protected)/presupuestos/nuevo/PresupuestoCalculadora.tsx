'use client'

import { Check, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/app/contexts/ToastContext'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
import {
  FORMATOS,
  type FormatoDatos, type TarifaTipo, type ParametrosPresupuesto,
} from '@/lib/presupuesto/config'
import {
  crearPresupuesto,
  type ModuloPresupuesto,
  type Comercial,
} from '@/app/actions/presupuestos'

const GRUPOS: { label: string; tipo: string }[] = [
  { label: 'Módulos',         tipo: 'modulo' },
  { label: 'Funcionalidades', tipo: 'funcionalidad' },
  { label: 'Addons',          tipo: 'addon' },
]

const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

type Prefill = { diagnosticoId: number | null; nombreNegocio: string; contacto: string; modulos: string[] }

export default function PresupuestoCalculadora({
  modulos,
  comerciales,
  comercialEmailDefault,
  tarifaSugerida,
  parametros,
  prefill,
}: {
  modulos: ModuloPresupuesto[]
  comerciales: Comercial[]
  comercialEmailDefault: string
  tarifaSugerida: TarifaTipo
  /** Precios vigentes, cargados en el servidor. */
  parametros: ParametrosPresupuesto
  prefill: Prefill
}) {
  const { error: toastError } = useToast()

  const [nombreNegocio, setNombreNegocio]         = useState(prefill.nombreNegocio)
  const [nombreResponsable, setNombreResponsable] = useState('')
  const [contacto, setContacto]                   = useState(prefill.contacto)
  const [comercialEmail, setComercialEmail]       = useState(comercialEmailDefault)
  const [tarifa, setTarifa]                       = useState<TarifaTipo>(tarifaSugerida)
  const [formato, setFormato]                     = useState<FormatoDatos>('cero')

  const [modulosSel, setModulosSel] = useState<string[]>(prefill.modulos)
  const [vol, setVol] = useState<Record<string, string>>({ empresas: '1', monedas: '1', cuentas_tesoreria: '1' })

  // La palanca comercial: la tarifa arranca en la base configurada y se puede pactar para
  // ESTE cliente. Antes solo se podía saltar de estándar a fundador, $10/h de golpe.
  const [tarifaHora, setTarifaHora] = useState(String(parametros.tarifaHora))
  const [descuento, setDescuento]   = useState('')
  const [dtoMotivo, setDtoMotivo]   = useState('')

  const [migDesea, setMigDesea]     = useState(false)
  const [migDesde, setMigDesde]     = useState('')
  const [migHasta, setMigHasta]     = useState('')
  const [migVolumen, setMigVolumen] = useState('')
  const [migHoras, setMigHoras]     = useState('')

  const [loading, setLoading] = useState(false)
  const [creado, setCreado]   = useState<{ id: number } | null>(null)

  const precioField = tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
  const cuotaMensual = modulos
    .filter(m => modulosSel.includes(m.clave))
    .reduce((s, m) => s + Number(m[precioField] ?? 0), 0)

  const volNum = useMemo(
    () => Object.fromEntries(Object.entries(vol).map(([k, v]) => [k, Number(v) || 0])),
    [vol],
  )

  const resultado = useMemo(() => calcularInstalacion({
    modulos: modulosSel,
    volumenes: volNum,
    formato,
    historicoHorasManual: migDesea ? Number(migHoras) || 0 : 0,
    tarifaHoraOverride: Number(tarifaHora) || 0,
    descuentoPct: Number(descuento) || 0,
  }, parametros), [modulosSel, volNum, formato, migDesea, migHoras, tarifaHora, descuento, parametros])

  // Los campos de volumen salen de los propios parámetros: al añadir una línea en
  // Configuración aparece su campo, sin tocar esta pantalla.
  const lineasVisibles = parametros.lineas
    .filter(l => !l.modulo || modulosSel.includes(l.modulo))
    .sort((a, b) => a.orden - b.orden)
  const camposFase1 = lineasVisibles.filter(l => l.fase === 1)
  const lineasFase2 = lineasVisibles.filter(l => l.fase === 2)

  function toggleModulo(clave: string) {
    setModulosSel(prev =>
      prev.includes(clave) ? prev.filter(c => c !== clave) : [...prev, clave]
    )
  }

  function setVolCampo(key: string, value: string) {
    setVol(prev => ({ ...prev, [key]: value }))
  }

  async function handleGuardar() {
    if (!nombreNegocio.trim()) { toastError('El nombre del negocio es obligatorio.'); return }
    setLoading(true)
    const comercialNombre = comerciales.find(c => c.email === comercialEmail)?.nombre
    const r = await crearPresupuesto({
      diagnosticoId:     prefill.diagnosticoId,
      comercialEmail,
      comercialNombre,
      nombreNegocio,
      nombreResponsable,
      contacto,
      tarifa,
      modulos: modulosSel,
      volumenes: volNum,
      formato,
      tarifaHora: Number(tarifaHora) || 0,
      descuentoPct: Number(descuento) || 0,
      descuentoMotivo: dtoMotivo,
      migracion: {
        desea:       migDesea,
        desde:       migDesde || null,
        hasta:       migHasta || null,
        volumen:     migVolumen ? Number(migVolumen) : null,
        horasManual: migHoras ? Number(migHoras) : null,
      },
    })
    setLoading(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudo guardar.'); return }
    setCreado({ id: r.id! })
  }

  if (creado) {
    return (
      <div className="view-container">
        <div className="card card-lg">
          <div className="success-icon-circle"><Check size={28} strokeWidth={2.5} /></div>
          <h1 className="modal-title modal-success-title">Presupuesto guardado</h1>
          <p className="modal-success-description">
            {nombreNegocio} · {resultado.horasTotal}h · {usd(resultado.totalFinalUsd)} de instalación · {usd(cuotaMensual)}/mes.
          </p>
          <div className="pres-acciones-cierre">
            <Link href="/admin/presupuestos" className="btn btn-primary">Ver presupuestos</Link>
            <Link href="/admin/presupuestos/nuevo" className="btn btn-secondary">Crear otro</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <nav className="breadcrumb" aria-label="Ruta de navegación">
            <Link href="/admin/presupuestos">Presupuestos</Link>
            <ChevronRight className="breadcrumb-sep" />
            <span className="breadcrumb-current">Nuevo presupuesto</span>
          </nav>
          <h1 className="page-title">Nuevo presupuesto de instalación</h1>
          <p className="page-subtitle">Calcula horas y coste a partir de los módulos y el volumen.</p>
        </div>
      </div>

      <div className="pres-layout">
        {/* ── Columna de entrada ── */}
        <div className="pres-form">
          {/* Datos del prospecto */}
          <div className="card">
            <p className="mod-list-label">Datos del prospecto</p>
            <div className="input-group">
              <label htmlFor="p-negocio">Nombre del negocio <span className="required">*</span></label>
              <input id="p-negocio" className="input" value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)} />
            </div>
            <div className="grid-cols-2">
              <div className="input-group">
                <label htmlFor="p-resp">Responsable</label>
                <input id="p-resp" className="input" value={nombreResponsable} onChange={e => setNombreResponsable(e.target.value)} />
              </div>
              <div className="input-group">
                <label htmlFor="p-contacto">Contacto (teléfono/WhatsApp)</label>
                <input id="p-contacto" className="input" value={contacto} onChange={e => setContacto(e.target.value)} />
              </div>
            </div>
            <div className="grid-cols-2">
              <div className="input-group">
                <label htmlFor="p-comercial">Comercial que atiende</label>
                <select id="p-comercial" className="input" value={comercialEmail} onChange={e => setComercialEmail(e.target.value)}>
                  {comerciales.length === 0 && <option value={comercialEmailDefault}>{comercialEmailDefault}</option>}
                  {comerciales.map(c => <option key={c.email} value={c.email}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="seg-field">
                <span className="seg-field-label">Tarifa</span>
                <div className="seg">
                  {(['estandar', 'fundador'] as const).map(t => (
                    <label key={t} className="seg-opt">
                      <input type="radio" name="tarifa" value={t} checked={tarifa === t} onChange={() => setTarifa(t)} />
                      <span>{t === 'estandar' ? 'Estándar' : 'Fundador'}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Módulos contratados */}
          <div className="card">
            <p className="mod-list-label">Módulos contratados</p>
            {GRUPOS.map(g => {
              const items = modulos.filter(m => m.tipo === g.tipo)
              if (!items.length) return null
              return (
                <div key={g.tipo} className="mod-list">
                  <p className="mod-list-label">{g.label}</p>
                  {items.map(m => {
                    const activo = modulosSel.includes(m.clave)
                    const precio = Number(m[precioField] ?? 0)
                    return (
                      <label key={m.clave} className="mod-row">
                        <span className="mod-row-main">
                          <span className="mod-row-name">{m.nombre}</span>
                        </span>
                        <span className={`mod-row-price${precio === 0 ? ' mod-row-price-free' : ''}`}>
                          {precio > 0 ? `+${usd(precio)}` : 'Gratis'}
                        </span>
                        <span className="switch">
                          <input type="checkbox" checked={activo}
                            onChange={() => toggleModulo(m.clave)} aria-label={`Contratar ${m.nombre}`} />
                          <span className="switch-track" aria-hidden="true" />
                        </span>
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Formato de los datos de origen */}
          <div className="card">
            <div className="input-group">
              <label htmlFor="p-formato">Formato de los datos de origen</label>
              <select id="p-formato" className="input" value={formato} onChange={e => setFormato(e.target.value as FormatoDatos)}>
                {FORMATOS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
          </div>

          {/* Datos de volumen */}
          <div className="card">
            <p className="mod-list-label">Datos de volumen</p>
            <div className="grid-cols-2">
              {[...camposFase1, ...lineasFase2].map(l => (
                <div key={l.clave} className="input-group">
                  <label htmlFor={`v-${l.clave}`}>{l.etiqueta}</label>
                  <input id={`v-${l.clave}`} type="number" min="0" className="input"
                    value={vol[l.clave] ?? ''} onChange={e => setVolCampo(l.clave, e.target.value)} />
                  {/* Lo que cuesta pasarse: el comercial ve el efecto ANTES de teclear, en vez
                      de descubrir que el precio saltó y no saber por qué. */}
                  <span className="input-hint">
                    {l.horas_base}h hasta {l.incluido} · +{l.horas_por_tramo}h por cada {l.tramo}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Migración de histórico */}
          <div className="card">
            <label className="checkbox-group">
              <input type="checkbox" checked={migDesea} onChange={e => setMigDesea(e.target.checked)} />
              <span className="checkbox-label">Migrar operaciones/movimientos anteriores (histórico)</span>
            </label>
            {migDesea && (
              <>
                <div className="alert alert-info">
                  Pendiente de cotización a medida: valóralo manualmente según estructura y volumen. Se cobra a la misma tarifa que el resto.
                </div>
                <div className="grid-cols-2">
                  <div className="input-group">
                    <label htmlFor="m-desde">Período desde</label>
                    <input id="m-desde" type="date" className="input" value={migDesde} onChange={e => setMigDesde(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label htmlFor="m-hasta">Período hasta</label>
                    <input id="m-hasta" type="date" className="input" value={migHasta} onChange={e => setMigHasta(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label htmlFor="m-vol">Volumen aprox. de movimientos</label>
                    <input id="m-vol" type="number" min="0" className="input" value={migVolumen} onChange={e => setMigVolumen(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label htmlFor="m-horas">Horas estimadas</label>
                    <input id="m-horas" type="number" min="0" step="0.5" className="input" value={migHoras} onChange={e => setMigHoras(e.target.value)} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Notas de política (§5) */}
          <div className="alert alert-warning">
            <strong>Recordatorio:</strong> si los datos entregados no cumplen lo declarado (más volumen, peor
            estructura), se informa del extra antes de continuar y se cotiza a medida. Si el comercial avanza
            sin validar y luego no cumplen, las horas extra corren por su cuenta.
          </div>
        </div>

        {/* ── Columna de resultado (en vivo) ── */}
        <div className="pres-resultado">
          <div className="card">
            <p className="mod-list-label">Resultado estimado</p>

            {/* LA TARIFA, A LA VISTA Y NEGOCIABLE. Antes el desglose enseñaba «8h · $280» y
                en ninguna parte decía a cuánto iba la hora: se negociaba sin ver el propio
                precio unitario. Arranca en la base de Configuración. */}
            <div className="pres-tarifa">
              <label htmlFor="p-tarifa">Tarifa por hora</label>
              <div className="pres-tarifa-campo">
                <span className="pres-tarifa-moneda">$</span>
                <input id="p-tarifa" type="number" min="0" step="any" className="input"
                  value={tarifaHora} onChange={e => setTarifaHora(e.target.value)} />
              </div>
              {Number(tarifaHora) !== parametros.tarifaHora && (
                <span className="input-hint">Base: {usd(parametros.tarifaHora)}/h</span>
              )}
            </div>

            <div className="pres-desglose">
              {resultado.desglose.map((d, i) => (
                <div key={i} className="pres-fase-bloque">
                  <div className="pres-fase-row">
                    <span className="pres-fase-nombre">{d.fase}</span>
                    <span className="pres-fase-horas">{d.horas}h</span>
                    <span className="pres-fase-sub col-num">{usd(d.subtotalUsd)}</span>
                  </div>
                  {/* Cada línea con su cuenta: «4 · 1h base + 3 × 0,5h». Es lo que se le lee
                      en voz alta al cliente cuando pregunta de dónde sale el número. */}
                  {d.lineas && d.lineas.length > 0 && (
                    <ul className="pres-fase-lineas">
                      {d.lineas.map(l => (
                        <li key={l.etiqueta}>
                          <span className="pres-linea-nombre">{l.etiqueta}</span>
                          <span className="pres-linea-detalle">{l.detalle}</span>
                          <span className="pres-linea-horas col-num">{l.horas}h</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            {resultado.revisiones.length > 0 && (
              <div className="alert alert-warning">
                <strong>Líneas a revisar</strong>
                <ul className="pres-revisiones">
                  {resultado.revisiones.map((r, i) => <li key={i}><strong>{r.linea}:</strong> {r.motivo}</li>)}
                </ul>
              </div>
            )}

            {/* EL DESCUENTO, CON MOTIVO. La otra palanca: la tarifa explica el coste, el
                descuento explica la concesión sin falsear las horas —que son las que luego
                se comparan con `horas_reales` para saber si la instalación salió a cuenta—.
                El motivo es obligatorio: sin él, dentro de tres meses nadie sabe por qué
                este cliente pagó $700 y no $1.000. */}
            <div className="pres-descuento">
              <div className="input-group">
                <label htmlFor="p-dto">Descuento (%)</label>
                <input id="p-dto" type="number" min="0" max="100" step="any" className="input"
                  value={descuento} onChange={e => setDescuento(e.target.value)} placeholder="0" />
              </div>
              {Number(descuento) > 0 && (
                <div className="input-group">
                  <label htmlFor="p-dto-motivo">Motivo <span className="required">*</span></label>
                  <input id="p-dto-motivo" className="input" value={dtoMotivo}
                    onChange={e => setDtoMotivo(e.target.value)}
                    placeholder="Cliente de referencia, pago por adelantado…" />
                </div>
              )}
            </div>

            <div className="pres-totales">
              <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{resultado.horasTotal}h</span></div>
              <div>
                <span className="pres-total-label">Coste instalación</span>
                <span className="pres-total-valor">{usd(resultado.costeInstalacionUsd)}</span>
              </div>
              {resultado.descuentoUsd > 0 && (
                <>
                  <div className="pres-total-dto">
                    <span className="pres-total-label">Descuento ({Number(descuento)}%)</span>
                    <span className="pres-total-valor">−{usd(resultado.descuentoUsd)}</span>
                  </div>
                  <div className="pres-total-final">
                    <span className="pres-total-label">Total a cobrar</span>
                    <span className="pres-total-valor">{usd(resultado.totalFinalUsd)}</span>
                  </div>
                </>
              )}
              <div><span className="pres-total-label">Cuota mensual</span><span className="pres-total-valor">{usd(cuotaMensual)}</span></div>
            </div>

            <button className="btn btn-primary btn-full" disabled={loading} onClick={handleGuardar}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar como presupuesto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { Check, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/app/contexts/ToastContext'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
import { importeCiclo } from '@/lib/billing'
import {
  FORMATOS, FASES_INSTALACION,
  dimensionesApretadas, nivelMinimoPorVolumenes,
  type FormatoDatos, type ParametrosPresupuesto,
} from '@/lib/presupuesto/config'
import { etiquetaDimension, type Dimension } from '@/lib/limites'
import { NIVELES, precioModulo, type Nivel } from '@/lib/niveles'
import {
  crearPresupuesto,
  actualizarPresupuesto,
  type ModuloPresupuesto,
  type Comercial,
  type MigracionInput,
} from '@/app/actions/presupuestos'

const GRUPOS: { label: string; tipo: string }[] = [
  { label: 'Módulos',         tipo: 'modulo' },
  { label: 'Funcionalidades', tipo: 'funcionalidad' },
  { label: 'Addons',          tipo: 'addon' },
]

const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`

type Prefill = {
  diagnosticoId: number | null
  /** Presupuesto para un cliente que YA existe (ampliación). */
  clientId: string | null
  nombreNegocio: string
  nombreResponsable: string
  contacto: string
  modulos: string[]
  nivel: Nivel | null
  // Campos que solo trae el modo edición, para reconstruir el snapshot completo del borrador
  // guardado. En alta van sin definir y caen a los valores por defecto de siempre.
  formato?: FormatoDatos | null
  volumenes?: Record<string, number> | null
  tarifaHora?: number | null
  descuentoPct?: number | null
  descuentoMotivo?: string | null
  fasesExcluidas?: number[] | null
  migracion?: MigracionInput | null
}

export default function PresupuestoCalculadora({
  modulos,
  comerciales,
  comercialEmailDefault,
  nivelSugerido,
  nombresNivel,
  limitesNivel,
  parametros,
  descuentoAnualPct,
  prefill,
  editarId,
}: {
  modulos: ModuloPresupuesto[]
  comerciales: Comercial[]
  comercialEmailDefault: string
  nivelSugerido: Nivel
  /** Cómo se llama hoy cada nivel (`niveles.nombre`, editable desde /admin). */
  nombresNivel: Record<Nivel, string>
  /** Topes de cada nivel (`nivel_limites`). Vacío si no se pudieron leer: entonces
   *  no se sugiere nada, que es mejor que sugerir con media matriz. */
  limitesNivel: Record<string, Record<string, number | null>>
  /** Precios vigentes, cargados en el servidor. */
  parametros: ParametrosPresupuesto
  descuentoAnualPct: number
  prefill: Prefill
  /** Si viene, se está EDITANDO ese presupuesto (borrador) en vez de creando uno. */
  editarId?: number | null
}) {
  const { error: toastError } = useToast()
  const editando = editarId != null

  const [nombreNegocio, setNombreNegocio]         = useState(prefill.nombreNegocio)
  const [nombreResponsable, setNombreResponsable] = useState(prefill.nombreResponsable)
  const [contacto, setContacto]                   = useState(prefill.contacto)
  const [comercialEmail, setComercialEmail]       = useState(comercialEmailDefault)
  const [nivel, setNivel]                         = useState<Nivel>(nivelSugerido)
  const [formato, setFormato]                     = useState<FormatoDatos>(prefill.formato ?? 'cero')

  const [modulosSel, setModulosSel] = useState<string[]>(prefill.modulos)
  // Los volúmenes se guardan como números; el input trabaja con texto. En edición se
  // restauran los del snapshot; en alta arrancan con una empresa/moneda/cuenta.
  const [vol, setVol] = useState<Record<string, string>>(
    prefill.volumenes
      ? Object.fromEntries(Object.entries(prefill.volumenes).map(([k, v]) => [k, String(v)]))
      : { empresas: '1', monedas: '1', cuentas_tesoreria: '1' },
  )

  // La palanca comercial: la tarifa/hora arranca en la base configurada y se puede pactar
  // para ESTE cliente, al céntimo. Antes solo se podía saltar de un escalón a otro.
  const [tarifaHora, setTarifaHora] = useState(String(prefill.tarifaHora ?? parametros.tarifaHora))
  const [descuento, setDescuento]   = useState(prefill.descuentoPct ? String(prefill.descuentoPct) : '')
  const [dtoMotivo, setDtoMotivo]   = useState(prefill.descuentoMotivo ?? '')

  // Fases que este cliente NO contrata. Vacío = las cuatro, que es el caso normal.
  const [fasesFuera, setFasesFuera] = useState<number[]>(prefill.fasesExcluidas ?? [])
  const enFase = (n: number) => !fasesFuera.includes(n)

  const [migDesea, setMigDesea]     = useState(prefill.migracion?.desea ?? false)
  const [migDesde, setMigDesde]     = useState(prefill.migracion?.desde ?? '')
  const [migHasta, setMigHasta]     = useState(prefill.migracion?.hasta ?? '')
  const [migVolumen, setMigVolumen] = useState(prefill.migracion?.volumen != null ? String(prefill.migracion.volumen) : '')
  const [migHoras, setMigHoras]     = useState(prefill.migracion?.horasManual != null ? String(prefill.migracion.horasManual) : '')

  const [loading, setLoading] = useState(false)
  const [creado, setCreado]   = useState<{ id: number; aviso?: string | null; tono?: 'info' | 'warning' } | null>(null)


  const modulosElegidos = modulos.filter(m => modulosSel.includes(m.clave))
  const cuotaMensual = modulosElegidos.reduce((s, m) => s + precioModulo(m, nivel), 0)
  const cuotaAnual   = importeCiclo(cuotaMensual, 'anual', descuentoAnualPct)
  const ahorroAnual  = Math.max(0, cuotaMensual * 12 - cuotaAnual)

  const volNum = useMemo(
    () => Object.fromEntries(Object.entries(vol).map(([k, v]) => [k, Number(v) || 0])),
    [vol],
  )

  // ¿Cabe el negocio en el nivel elegido? Los volúmenes ya están tecleados para
  // calcular la instalación; compararlos con los topes del nivel es gratis y evita
  // el error caro: cotizar Inicial a quien el día 1 no va a poder dar de alta a su
  // gente. No cambia el nivel solo — el nivel es una decisión comercial y a veces
  // se pacta a la baja a propósito —, avisa y ofrece el cambio.
  const apretadas = useMemo(
    () => dimensionesApretadas(limitesNivel[nivel] ?? {}, volNum),
    [limitesNivel, nivel, volNum],
  )
  const nivelMinimo = useMemo(
    () => Object.keys(limitesNivel).length
      ? (nivelMinimoPorVolumenes([...NIVELES], limitesNivel, volNum) as Nivel | null)
      : null,
    [limitesNivel, volNum],
  )

  const resultado = useMemo(() => calcularInstalacion({
    modulos: modulosSel,
    volumenes: volNum,
    formato,
    historicoHorasManual: migDesea ? Number(migHoras) || 0 : 0,
    tarifaHoraOverride: Number(tarifaHora) || 0,
    descuentoPct: Number(descuento) || 0,
    fasesExcluidas: fasesFuera,
  }, parametros), [modulosSel, volNum, formato, migDesea, migHoras, tarifaHora, descuento, fasesFuera, parametros])

  // Los campos de volumen salen de los propios parámetros: al añadir una línea en
  // Configuración aparece su campo, sin tocar esta pantalla. Los de una fase excluida NO se
  // piden: teclear un volumen que ya no mueve el precio es pedir trabajo para nada.
  const lineasVisibles = parametros.lineas
    .filter(l => !l.modulo || modulosSel.includes(l.modulo))
    .filter(l => enFase(l.fase))
    .sort((a, b) => a.orden - b.orden)
  const camposFase1 = lineasVisibles.filter(l => l.fase === 1)
  const lineasFase2 = lineasVisibles.filter(l => l.fase === 2)

  function toggleModulo(clave: string) {
    setModulosSel(prev =>
      prev.includes(clave) ? prev.filter(c => c !== clave) : [...prev, clave]
    )
  }

  function toggleFase(num: number) {
    setFasesFuera(prev =>
      prev.includes(num) ? prev.filter(n => n !== num) : [...prev, num]
    )
  }

  function setVolCampo(key: string, value: string) {
    setVol(prev => ({ ...prev, [key]: value }))
  }

  async function handleGuardar() {
    if (!nombreNegocio.trim()) { toastError('El nombre del negocio es obligatorio.'); return }
    setLoading(true)
    const comercialNombre = comerciales.find(c => c.email === comercialEmail)?.nombre
    const input = {
      diagnosticoId:     prefill.diagnosticoId,
      clientId:          prefill.clientId,
      comercialEmail,
      comercialNombre,
      nombreNegocio,
      nombreResponsable,
      contacto,
      nivel,
      modulos: modulosSel,
      volumenes: volNum,
      formato,
      tarifaHora: Number(tarifaHora) || 0,
      descuentoPct: Number(descuento) || 0,
      descuentoMotivo: dtoMotivo,
      fasesExcluidas: fasesFuera,
      migracion: {
        desea:       migDesea,
        desde:       migDesde || null,
        hasta:       migHasta || null,
        volumen:     migVolumen ? Number(migVolumen) : null,
        horasManual: migHoras ? Number(migHoras) : null,
      },
    }
    const r = editando
      ? await actualizarPresupuesto(editarId, input)
      : await crearPresupuesto(input)
    setLoading(false)
    if (!r.ok) { toastError(r.error ?? 'No se pudo guardar.'); return }
    // Editar un presupuesto mueve su cobro de configuración (lo ajusta, lo crea o
    // lo retira). Se dice aquí, en la pantalla que queda, y no en un toast que se va.
    // Solo `actualizarPresupuesto` trae aviso: un presupuesto NUEVO nace en
    // borrador y un borrador no mueve cobros.
    const cobro = r as { aviso?: string | null; avisoTono?: 'info' | 'warning' }
    setCreado({ id: r.id!, aviso: cobro.aviso ?? null, tono: cobro.avisoTono ?? 'info' })
  }

  if (creado) {
    return (
      <div className="view-container">
        <div className="card card-lg">
          <div className="success-icon-circle"><Check size={28} strokeWidth={2.5} /></div>
          <h1 className="modal-title modal-success-title">{editando ? 'Cambios guardados' : 'Presupuesto guardado'}</h1>
          <p className="modal-success-description">
            {nombreNegocio} · {resultado.horasTotal}h · {usd(resultado.totalFinalUsd)} de instalación · {usd(cuotaMensual)}/mes.
          </p>
          {creado.aviso && (
            <div className={`alert ${creado.tono === 'warning' ? 'alert-warning' : 'alert-info'}`}>
              {creado.aviso}
            </div>
          )}
          <div className="pres-acciones-cierre">
            <Link href="/admin/presupuestos" className="btn btn-primary">Ver presupuestos</Link>
            {!editando && (
              <Link href="/admin/presupuestos/nuevo" className="btn btn-secondary">Crear otro</Link>
            )}
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
            <span className="breadcrumb-current">{editando ? 'Editar presupuesto' : 'Nuevo presupuesto'}</span>
          </nav>
          <h1 className="page-title">{editando ? 'Editar presupuesto de instalación' : 'Nuevo presupuesto de instalación'}</h1>
          <p className="page-subtitle">
            {editando
              ? 'Ajusta los módulos, el volumen o el precio; se recalcula al guardar.'
              : 'Calcula horas y coste a partir de los módulos y el volumen.'}
          </p>
        </div>
      </div>

      <div className="pres-layout">
        {/* ── Columna de entrada ── */}
        <div className="pres-form">
          {/* Datos del prospecto */}
          <div className="card">
            <p className="mod-list-label">Datos del prospecto</p>
            {/* Que quede claro a quién se le está cotizando: en una ampliación los módulos
                que salen marcados son los que YA tiene, no los que se le van a cobrar de
                nuevo — marcarlos «otra vez» sería cobrar dos veces su configuración. */}
            {prefill.clientId && (
              <div className="alert alert-info">
                Presupuesto para un cliente en marcha (<strong>{prefill.clientId}</strong>).
                Vienen marcados sus módulos actuales: deja solo los que entran en esta
                instalación.
              </div>
            )}
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
                  {/* Si el comercial guardado ya no está en la lista de activos (p. ej. al editar
                      un borrador viejo), se mantiene como opción para no perderlo en silencio. */}
                  {!comerciales.some(c => c.email === comercialEmail) && (
                    <option value={comercialEmail}>{comercialEmail}</option>
                  )}
                  {comerciales.map(c => <option key={c.email} value={c.email}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="seg-field">
                <span className="seg-field-label">Nivel</span>
                <div className="seg">
                  {NIVELES.map(t => (
                    <label key={t} className="seg-opt">
                      <input type="radio" name="nivel" value={t} checked={nivel === t} onChange={() => setNivel(t)} />
                      <span>{nombresNivel[t]}</span>
                    </label>
                  ))}
                </div>
                {apretadas.length > 0 && nivelMinimo && (
                  <div className="alert alert-warning mt-4">
                    <strong className="alert-titulo">
                      Con estos volúmenes no cabe en {nombresNivel[nivel]}
                    </strong>
                    {apretadas.map(d => (
                      <span key={d.dimension} className="pres-apretada">
                        {etiquetaDimension(d.dimension as Dimension)}: {d.volumen} y el tope son {d.tope}
                      </span>
                    ))}
                    {nivelMinimo !== nivel && (
                      <button type="button" className="btn btn-aviso btn-sm" onClick={() => setNivel(nivelMinimo)}>
                        Pasar a {nombresNivel[nivelMinimo]}
                      </button>
                    )}
                  </div>
                )}
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
                    const precio = precioModulo(m, nivel)
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

          {/* Fases de la instalación. No todas las instalaciones las llevan: un negocio que
              empieza de cero no tiene nada que migrar, y hay clientes que no quieren
              formación. Desmarcar una la quita del precio Y del desglose que ve el cliente. */}
          <div className="card">
            <p className="mod-list-label">Fases incluidas</p>
            <div className="mod-list">
              {FASES_INSTALACION.map(f => (
                <label key={f.num} className="mod-row">
                  <span className="mod-row-main">
                    <span className="mod-row-name">{f.etiqueta}</span>
                  </span>
                  <span className="switch">
                    <input type="checkbox" checked={enFase(f.num)}
                      onChange={() => toggleFase(f.num)}
                      aria-label={`Incluir ${f.etiqueta}`} />
                    <span className="switch-track" aria-hidden="true" />
                  </span>
                </label>
              ))}
            </div>
            {fasesFuera.length > 0 && (
              <p className="input-hint">
                Lo que se desmarca no se cobra ni aparece en el presupuesto del cliente.
              </p>
            )}
          </div>

          {/* Formato de los datos de origen. Solo dice algo si hay migración: es lo que
              decide si las horas estimadas se quedan cortas. */}
          {enFase(2) && (
            <div className="card">
              <div className="input-group">
                <label htmlFor="p-formato">Formato de los datos de origen</label>
                <select id="p-formato" className="input" value={formato} onChange={e => setFormato(e.target.value as FormatoDatos)}>
                  {FORMATOS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Datos de volumen */}
          {[...camposFase1, ...lineasFase2].length > 0 && (
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
          )}

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

            {resultado.desglose.length === 0 && (
              <div className="alert alert-info">
                Sin fases contratadas: la instalación no se cobra. Solo se factura la cuota mensual.
              </div>
            )}

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

            {/* DOS PRECIOS, DOS BLOQUES. La instalación se paga una vez y la suscripción cada
                mes: juntarlas en una lista hacía que se sumaran dos cifras que nunca se pagan
                a la vez, y la pregunta del cliente pasaba a ser «¿esto es hoy o al mes?». */}
            <div className="pres-totales">
              <p className="pres-bloque-titulo">Pago único · Instalación</p>
              <div><span className="pres-total-label">Horas totales</span><span className="pres-total-valor">{resultado.horasTotal}h</span></div>
              <div>
                <span className="pres-total-label">Coste instalación</span>
                <span className="pres-total-valor">{usd(resultado.costeInstalacionUsd)}</span>
              </div>
              {resultado.descuentoUsd > 0 && (
                <div className="pres-total-dto">
                  <span className="pres-total-label">Descuento ({Number(descuento)}%)</span>
                  <span className="pres-total-valor">−{usd(resultado.descuentoUsd)}</span>
                </div>
              )}
              <div className="pres-total-final">
                <span className="pres-total-label">Total a pagar una vez</span>
                <span className="pres-total-valor">{usd(resultado.totalFinalUsd)}</span>
              </div>
            </div>

            <div className="pres-totales">
              <p className="pres-bloque-titulo">Suscripción · {modulosElegidos.length} contratado{modulosElegidos.length !== 1 ? 's' : ''}</p>
              <div className="pres-total-final">
                <span className="pres-total-label">Cada mes</span>
                <span className="pres-total-valor">{usd(cuotaMensual)}</span>
              </div>
              {cuotaMensual > 0 && (
                <>
                  <div>
                    <span className="pres-total-label">Pagando por año (−{descuentoAnualPct}%)</span>
                    <span className="pres-total-valor">{usd(cuotaAnual)}</span>
                  </div>
                  {ahorroAnual > 0 && (
                    <div>
                      <span className="pres-total-label">Ahorro anual</span>
                      <span className="pres-total-valor">{usd(ahorroAnual)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <button className="btn btn-primary btn-full" disabled={loading} onClick={handleGuardar}>
              {loading
                ? <><span className="spinner" /> Guardando...</>
                : editando ? 'Guardar cambios' : 'Guardar como presupuesto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

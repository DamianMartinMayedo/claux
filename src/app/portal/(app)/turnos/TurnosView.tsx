'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { empresaColorVar } from '@/components/portal/EmpresaTag'
import FormHelp from '@/components/portal/FormHelp'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
import {
  guardarTurnoUnificado,
  eliminarTurnoUnificado,
  alternarPatron,
  type Turno,
  type TurnoPatron,
  type TipoPatron,
  type TurnosPageData,
} from '@/app/actions/portal/rrhh'
import { ChevronLeft, ChevronRight, Clock, Pencil, Plus, Power, Repeat, Search, Trash2, Users, X } from 'lucide-react'
import ExportarMenu from '@/components/portal/ExportarMenu'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { cruzaMedianoche, posicionEnCiclo } from '@/lib/rrhh/turnos'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'

// ── Constantes ────────────────────────────────────────────────────────────────

const DIAS = [
  { n: 1, label: 'Lun', largo: 'lunes' },     { n: 2, label: 'Mar', largo: 'martes' },
  { n: 3, label: 'Mié', largo: 'miércoles' }, { n: 4, label: 'Jue', largo: 'jueves' },
  { n: 5, label: 'Vie', largo: 'viernes' },   { n: 6, label: 'Sáb', largo: 'sábado' },
  { n: 7, label: 'Dom', largo: 'domingo' },
]

const TURNO_COLORS = [
  { value: '#00AFAA', label: 'Teal' },
  { value: '#C97A0C', label: 'Ámbar' },
  { value: '#2E7D32', label: 'Verde' },
  { value: '#1565C0', label: 'Azul' },
  { value: '#6A1B9A', label: 'Morado' },
  { value: '#AD1457', label: 'Rosa' },
]

// Frecuencias de la «rotación avanzada». La semanal es el modo simple (marcar días); las
// demás repiten un ciclo más largo desde una fecha de inicio.
type TipoAvanzado = Exclude<TipoPatron, 'SEMANAL'>
const LONGITUD_AVANZADO: Record<TipoAvanzado, number | null> = { QUINCENAL: 14, MENSUAL: 28, CICLO: null }
const TIPOS_AVANZADO: { value: TipoAvanzado; label: string }[] = [
  { value: 'QUINCENAL', label: 'Quincenal (2 semanas)' },
  { value: 'MENSUAL',   label: 'Mensual (4 semanas)' },
  { value: 'CICLO',     label: 'Ciclo N×M' },
]

type Horizonte = 'semana' | 'quincena' | 'mes'
const HORIZONTES: { value: Horizonte; label: string }[] = [
  { value: 'semana',   label: 'Semana' },
  { value: 'quincena', label: 'Quincena' },
  { value: 'mes',      label: 'Mes' },
]

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// SEMANAL: la posición 0 del ciclo se ancla a un lunes fijo, así «posición p» = día de la
// semana p. 2024-01-01 fue lunes. Los demás tipos anclan a la fecha que elige el dueño.
const REF_LUNES = '2024-01-01'

function formatHora(h: string | null): string {
  return h ? h.slice(0, 5) : ''
}
function horario(t: Turno): string {
  if (t.es_descanso) return 'Descanso'
  const i = formatHora(t.hora_inicio), f = formatHora(t.hora_fin)
  if (i && f) return `${i}–${f}${cruzaMedianoche(t) ? ' (+1 día)' : ''}`
  return i || f || 'Sin horario'
}
const nombreDe = (e: { nombre: string; apellidos: string | null }) =>
  [e.nombre, e.apellidos].filter(Boolean).join(' ')

/** Nombre corto del día de la semana de una fecha 'YYYY-MM-DD' (LUNES-based labels). */
function diaSemanaCorto(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const js = new Date(y, m - 1, d).getDay()   // 0=Dom … 6=Sáb
  return DIAS[(js + 6) % 7].label
}
/** Día y mes cortos para la cabecera de la vista previa. */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}/${m}`
}
/** Resume unas posiciones de la semana (0=Lun … 6=Dom) como «Lun–Vie» o «Lun, Mié, Vie». */
function rangoDias(pos: number[]): string {
  const s = [...pos].sort((a, b) => a - b)
  const labels = s.map(i => DIAS[i]?.label ?? '')
  const contiguo = s.every((v, i) => i === 0 || v === s[i - 1] + 1)
  if (contiguo && s.length > 2) return `${labels[0]}–${labels[labels.length - 1]}`
  return labels.join(', ')
}

// ── Aritmética de calendario (todo en UTC para no derivar por zona) ──────────────
/** Lunes de la semana que contiene la fecha (semana Lun→Dom). */
function lunesDe(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0=Dom … 6=Sáb
  return sumarDias(iso, -((dow + 6) % 7))
}
/** Primer día del mes de la fecha ('2026-08-14' → '2026-08-01'). */
const primerDiaMes = (iso: string): string => `${iso.slice(0, 7)}-01`
/** Días que tiene el mes de la fecha. */
function diasEnMes(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
/** Suma n meses a un primer-de-mes, devolviendo otro primer-de-mes. */
function sumarMeses(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}
/** Nº de días de a→b inclusive (b ≥ a). */
function diasEntre(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}
/** Número de día del mes ('2026-08-14' → 14). */
const diaDelMes = (iso: string): number => Number(iso.slice(8, 10))
/** Fecha larga y humana para el título del modal ('2026-08-14' → 'jueves 14 de agosto'). */
function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DIAS[(dow + 6) % 7].largo} ${d} de ${MESES_LARGOS[m - 1]}`
}

// ── Tipos del cuadrante ───────────────────────────────────────────────────────

interface EmpleadoMin { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null }

/** Persona dentro de una banda del día. */
type PersonaTurno = { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null }
/** Cobertura de una banda concreta en un día. */
interface FranjaDia { franja: Turno; empleados: PersonaTurno[] }
/** Detalle de un día del calendario: todas sus bandas de trabajo y quién las cubre. */
interface DiaDetalle { fecha: string; franjas: FranjaDia[] }

// ── Modal: crear / editar TURNO (banda horaria + días/rotación + equipo) ──────────
//
// Un turno es UNA cosa para el dueño: un horario con color, los días que se trabaja y
// quién lo cubre. Por debajo sigue siendo franja + patrón + roster (mig. 182), así el
// puente de nómina lee lo mismo. Modo simple = una semana fija (marcar días); «Rotación
// avanzada» = ciclos de dos/cuatro semanas o «trabaja N y descansa M».

/** Valores iniciales del modal (los deriva el padre al editar; por defecto, turno nuevo). */
interface SeedTurno {
  nombre:     string
  color:      string
  horaInicio: string
  horaFin:    string
  franjaId:   string            // banda existente al editar; '' = nueva
  modo:       'simple' | 'avanzado'
  tipo:       TipoAvanzado      // solo relevante en avanzado
  ancla:      string
  dias:       number[]          // posiciones 0..6 (Lun..Dom) del modo simple
  posiciones: number[]          // posiciones trabajadas del modo avanzado (Quincenal/Mensual)
  cicloOn:    number
  cicloOff:   number
  roster:     [string, number][]   // [empleado_id, offset]
  multiBanda: boolean           // formato anterior con varias franjas
}

function TurnoUnificadoModal({
  patron, empresaId, empleados, seed, onClose, onSaved,
}: {
  patron:    TurnoPatron | null
  empresaId: string
  empleados: EmpleadoMin[]
  seed:      SeedTurno
  onClose:   () => void
  onSaved:   () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!patron

  const [nombre, setNombre]         = useState(seed.nombre)
  const [color,  setColor]          = useState(seed.color)
  const [horaInicio, setHoraInicio] = useState(seed.horaInicio)
  const [horaFin,    setHoraFin]    = useState(seed.horaFin)
  const [modo,   setModo]           = useState<'simple' | 'avanzado'>(seed.modo)
  const [tipo,   setTipo]           = useState<TipoAvanzado>(seed.tipo)
  const [ancla,  setAncla]          = useState(seed.ancla)
  const [dias,   setDias]           = useState<Set<number>>(new Set(seed.dias))
  const [pos,    setPos]            = useState<Set<number>>(new Set(seed.posiciones))
  const [cicloOn,  setCicloOn]      = useState(seed.cicloOn)
  const [cicloOff, setCicloOff]     = useState(seed.cicloOff)
  const [roster, setRoster]         = useState<Map<string, number>>(new Map(seed.roster))

  const longitud   = tipo === 'CICLO' ? cicloOn + cicloOff : (LONGITUD_AVANZADO[tipo] ?? 14)
  const pideOffset = modo === 'avanzado'   // en semanal el offset movería el día: no aplica
  const anclaOk    = /^\d{4}-\d{2}-\d{2}$/.test(ancla)

  function toggleDia(i: number) { setDias(prev => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s }) }
  function togglePos(i: number) { setPos(prev => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s }) }
  function toggleMiembro(id: string) {
    setRoster(prev => { const m = new Map(prev); if (m.has(id)) m.delete(id); else m.set(id, 0); return m })
  }
  function setOffset(id: string, off: number) {
    setRoster(prev => { const m = new Map(prev); if (m.has(id)) m.set(id, off); return m })
  }
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!nombre.trim()) { toastError('Ponle un nombre al turno.'); return }

    let tipoFinal: TipoPatron
    let longitudFinal: number
    let anclaFinal: string
    let posiciones: number[]

    if (modo === 'simple') {
      tipoFinal = 'SEMANAL'; longitudFinal = 7; anclaFinal = REF_LUNES
      posiciones = Array.from(dias).sort((a, b) => a - b)
      if (!posiciones.length) { toastError('Marca al menos un día de la semana.'); return }
    } else if (tipo === 'CICLO') {
      if (cicloOn < 1) { toastError('En un ciclo N×M pon los días que se trabaja.'); return }
      if (!anclaOk)    { toastError('Elige la fecha de inicio del ciclo.'); return }
      tipoFinal = 'CICLO'; longitudFinal = cicloOn + cicloOff; anclaFinal = ancla
      posiciones = Array.from({ length: cicloOn }, (_, i) => i)
    } else {
      if (!anclaOk) { toastError('Elige la fecha de inicio del ciclo.'); return }
      tipoFinal = tipo; longitudFinal = LONGITUD_AVANZADO[tipo]!; anclaFinal = ancla
      posiciones = Array.from(pos).filter(p => p < longitudFinal).sort((a, b) => a - b)
      if (!posiciones.length) { toastError('Marca al menos un día de trabajo del ciclo.'); return }
    }

    const fd = new FormData()
    if (patron)        fd.set('patron_id', patron.patron_id)
    if (seed.franjaId) fd.set('franja_id', seed.franjaId)
    fd.set('empresa_id', empresaId)
    fd.set('nombre', nombre.trim())
    if (color)      fd.set('color', color)
    if (horaInicio) fd.set('hora_inicio', horaInicio)
    if (horaFin)    fd.set('hora_fin', horaFin)
    fd.set('tipo', tipoFinal)
    fd.set('fecha_ancla', anclaFinal)
    fd.set('longitud_dias', String(longitudFinal))
    fd.set('posiciones', JSON.stringify(posiciones))
    const miembros = Array.from(roster.entries()).map(([empleado_id, offset_ciclo]) => ({ empleado_id, offset_ciclo }))
    fd.set('roster', JSON.stringify(miembros))

    const ld = toastLoading(isEdit ? 'Guardando turno…' : 'Creando turno…')
    startTransition(async () => {
      const res = await guardarTurnoUnificado(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(isEdit ? 'Turno actualizado' : 'Turno creado')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar turno' : 'Nuevo turno'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-wide">
            <div className="ter-form-grid">
              {seed.multiBanda && (
                <div className="ter-col-full">
                  <div className="alert alert-warning">
                    Este turno usaba <strong>varias franjas</strong> (formato anterior). Al guardar quedará
                    con una sola banda horaria; si necesitas horarios distintos en días distintos, créalos
                    como dos turnos y mete a la persona en ambos.
                  </div>
                </div>
              )}

              <div className="input-group ter-col-span-2">
                <label htmlFor="tur-nombre">Nombre <span className="required">*</span></label>
                <input className="input" id="tur-nombre" value={nombre} autoFocus
                  onChange={e => setNombre(e.target.value)} placeholder="Mañana, Tarde, Fin de semana…" />
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="tur-ini">Hora inicio</label>
                <input className="input" id="tur-ini" type="time" value={horaInicio}
                  onChange={e => setHoraInicio(e.target.value)} />
              </div>
              <div className="input-group ter-col-span-2">
                <div className="form-label-with-help">
                  <label htmlFor="tur-fin">Hora fin</label>
                  <FormHelp text="Si es menor que la de inicio, cruza la medianoche." label="Información sobre la hora fin" />
                </div>
                <input className="input" id="tur-fin" type="time" value={horaFin}
                  onChange={e => setHoraFin(e.target.value)} />
              </div>
              <div className="input-group ter-col-full">
                <label id="tur-color-label">Color</label>
                <div className="color-picker" role="radiogroup" aria-labelledby="tur-color-label">
                  {TURNO_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`color-swatch${color === c.value ? ' selected' : ''}`}
                      style={empresaColorVar(c.value)}
                      onClick={() => setColor(c.value)}
                      aria-label={c.label}
                      aria-checked={color === c.value}
                      role="radio"
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="input-group ter-col-full">
                <div className="form-label-with-help">
                  <label className="filtro-toggle">
                    <input type="checkbox" className="row-check" checked={modo === 'avanzado'}
                      onChange={e => setModo(e.target.checked ? 'avanzado' : 'simple')} />
                    Rotación avanzada
                  </label>
                  <FormHelp text="Para turnos que no son una semana fija: ciclos de dos o cuatro semanas, o «trabaja N días seguidos y descansa M»." label="Cuándo usar la rotación avanzada" />
                </div>
              </div>

              {modo === 'simple' ? (
                <div className="input-group ter-col-full">
                  <div className="form-label-with-help">
                    <label>Días de la semana</label>
                    <FormHelp text="Marca los días que se trabaja este turno; el resto son descanso." label="Cómo marcar los días" />
                  </div>
                  <div className="turno-dias-chips">
                    {DIAS.map((d, i) => {
                      const on = dias.has(i)
                      return (
                        <button type="button" key={d.n} aria-pressed={on}
                          className={`turno-dia-chip${on ? ' turno-dia-chip-on' : ''}`}
                          onClick={() => toggleDia(i)}>{d.label}</button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <div className="input-group ter-col-span-2">
                    <div className="form-label-with-help">
                      <label htmlFor="tur-freq">Frecuencia</label>
                      <FormHelp text={tipo === 'QUINCENAL'
                        ? 'Un ciclo de dos semanas que se repite.'
                        : tipo === 'MENSUAL'
                          ? 'Un ciclo de cuatro semanas que se repite.'
                          : 'Trabaja N días seguidos y descansa M, sin atarse a la semana.'}
                        label="Información sobre la frecuencia" />
                    </div>
                    <select className="input" id="tur-freq" value={tipo}
                      onChange={e => setTipo(e.target.value as TipoAvanzado)}>
                      {TIPOS_AVANZADO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="input-group ter-col-span-2">
                    <div className="form-label-with-help">
                      <label htmlFor="tur-ancla">Empieza el <span className="required">*</span></label>
                      <FormHelp text="El primer día del ciclo. Desde aquí se cuenta la rotación."
                        label="Información sobre la fecha de inicio" />
                    </div>
                    <input className="input" id="tur-ancla" type="date" value={ancla}
                      onChange={e => setAncla(e.target.value)} />
                  </div>

                  {tipo === 'CICLO' ? (
                    <div className="input-group ter-col-full">
                      <div className="form-label-with-help">
                        <label>El ciclo</label>
                        <FormHelp text="Cada persona puede arrancar desplazada para cubrir todos los días."
                          label="Información sobre el ciclo" />
                      </div>
                      <div className="turno-ciclo-nm">
                        <span>Trabaja</span>
                        <input className="input turno-nm-num" type="number" min={1} max={30} value={cicloOn}
                          onChange={e => setCicloOn(Math.max(1, Number(e.target.value) || 1))} aria-label="Días que trabaja" />
                        <span>días y descansa</span>
                        <input className="input turno-nm-num" type="number" min={0} max={30} value={cicloOff}
                          onChange={e => setCicloOff(Math.max(0, Number(e.target.value) || 0))} aria-label="Días que descansa" />
                        <span>días.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="input-group ter-col-full">
                      <div className="form-label-with-help">
                        <label>Días de trabajo del ciclo ({longitud} días)</label>
                        <FormHelp text="Marca los días del ciclo que se trabaja; el resto son descanso."
                          label="Información sobre los días de trabajo del ciclo" />
                      </div>
                      <div className="turno-pos-grid">
                        {Array.from({ length: longitud }, (_, p) => {
                          const on = pos.has(p)
                          return (
                            <button type="button" key={p} aria-pressed={on}
                              className={`turno-pos-chip${on ? ' turno-pos-chip-on' : ''}`}
                              onClick={() => togglePos(p)}>
                              <span className="turno-pos-sem">S{Math.floor(p / 7) + 1}</span>
                              <span className="turno-pos-dia">{anclaOk ? diaSemanaCorto(sumarDias(ancla, p)) : `D${p + 1}`}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Equipo ── */}
              <div className="input-group ter-col-full">
                <label>Quién trabaja este turno</label>
                {empleados.length === 0 ? (
                  <span className="input-hint">No hay trabajadores activos en esta empresa.</span>
                ) : (
                  <div className="turno-roster-lista">
                    {empleados.map(e => {
                      const activo = roster.has(e.empleado_id)
                      return (
                        <div className={`turno-roster-item${activo ? ' turno-roster-on' : ''}`} key={e.empleado_id}>
                          <label className="turno-roster-nombre">
                            <input type="checkbox" className="row-check" checked={activo}
                              onChange={() => toggleMiembro(e.empleado_id)} />
                            <span>{nombreDe(e)}{e.cargo ? ` · ${e.cargo}` : ''}</span>
                          </label>
                          {activo && pideOffset && (
                            <label className="turno-roster-offset">
                              Empieza el día
                              <input className="input turno-nm-num" type="number" min={0} max={longitud - 1}
                                value={roster.get(e.empleado_id) ?? 0}
                                onChange={ev => setOffset(e.empleado_id, Math.max(0, Number(ev.target.value) || 0))}
                                aria-label={`Offset de ${nombreDe(e)}`} />
                              del ciclo
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear turno'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Página: Turnos ───────────────────────────────────────────────────────────────

export default function TurnosView({ data }: { data: TurnosPageData }) {
  const router = useRouter()
  const params = useSearchParams()

  const empresaUrl = params.get('empresa') ?? ''
  const empresaId  = data.empresas.some(e => e.empresa_id === empresaUrl)
    ? empresaUrl
    : (data.empresas[0]?.empresa_id ?? '')
  const busquedaUrl = (params.get('q') ?? '').trim().toLowerCase()

  function navegar(cambios: Record<string, string>) {
    const url = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) { if (v) url.set(k, v); else url.delete(k) }
    router.replace(`?${url.toString()}`, { scroll: false })
  }

  const resumenEmpresa = [data.empresas.find(e => e.empresa_id === empresaId)?.nombre ?? '']
    .filter((x): x is string => Boolean(x))

  const [modalTurno,      setModalTurno]      = useState<TurnoPatron | null>(null)
  const [modalNuevoTurno, setModalNuevoTurno] = useState(false)
  const [delTurno,        setDelTurno]        = useState<TurnoPatron | null>(null)
  const [horizonte,       setHorizonte]       = useState<Horizonte>('mes')
  const [vistaCuadrante,  setVistaCuadrante]  = useState<'calendario' | 'persona'>('calendario')
  const [diaModal,        setDiaModal]        = useState<DiaDetalle | null>(null)
  const [isPending,       startTransition]    = useTransition()
  const [isSearchPending, startSearchTransition] = useTransition()
  const [textoBusqueda,   setTextoBusqueda]   = useState(busquedaUrl)
  const busqueda = textoBusqueda.trim().toLowerCase()

  useEffect(() => { setTextoBusqueda(busquedaUrl) }, [busquedaUrl])

  function buscarTrabajador(value: string) {
    setTextoBusqueda(value)
    startSearchTransition(() => navegar({ q: value }))
  }

  // El cuadrante parte de «hoy» (zona del negocio). `ancla` es el día de referencia del
  // período que se ve; se navega con ‹ › sin salir de la página. Ambos se fijan tras
  // montar para no arriesgar un desajuste de hidratación en el cambio de día.
  const [hoy,   setHoy]   = useState<string | null>(null)
  const [ancla, setAncla] = useState<string | null>(null)
  useEffect(() => { const h = hoyEnTz(); setHoy(h); setAncla(h) }, [])

  const franjas = useMemo(
    () => data.turnos_catalogo.filter(t => t.empresa_id === empresaId),
    [data.turnos_catalogo, empresaId],
  )
  const franjaPorId = useMemo(() => new Map(franjas.map(f => [f.turno_id, f])), [franjas])

  const patrones = useMemo(
    () => data.patrones.filter(p => p.empresa_id === empresaId),
    [data.patrones, empresaId],
  )
  const patronPorId = useMemo(() => new Map(patrones.map(p => [p.patron_id, p])), [patrones])

  // Secuencia resuelta de cada patrón: (Turno | null)[] por posición del ciclo.
  const slotsResueltos = useMemo(() => {
    const porPatron = new Map<string, (Turno | null)[]>()
    for (const p of patrones) porPatron.set(p.patron_id, new Array(p.longitud_dias).fill(null))
    for (const s of data.slots) {
      const arr = porPatron.get(s.patron_id)
      if (!arr || s.posicion < 0 || s.posicion >= arr.length) continue
      arr[s.posicion] = s.turno_id ? (franjaPorId.get(s.turno_id) ?? null) : null
    }
    return porPatron
  }, [patrones, data.slots, franjaPorId])

  const miembrosPorPatron = useMemo(() => {
    const m = new Map<string, number>()
    for (const mi of data.miembros) m.set(mi.patron_id, (m.get(mi.patron_id) ?? 0) + 1)
    return m
  }, [data.miembros])

  const empleadosEmpresa = useMemo(
    () => data.empleados.filter(e => e.estado === 'ACTIVO' && e.empresa_id === empresaId),
    [data.empleados, empresaId],
  )
  const empleadosVista = useMemo(
    () => vistaCuadrante === 'persona'
      ? empleadosEmpresa.filter(e =>
          !busqueda || nombreDe(e).toLowerCase().includes(busqueda) || (e.cargo ?? '').toLowerCase().includes(busqueda))
      : empleadosEmpresa,
    [empleadosEmpresa, busqueda, vistaCuadrante],
  )
  // Roster por empleado (solo patrones ACTIVOS): la vista previa y los conflictos salen de aquí.
  const patronesPorEmpleado = useMemo(() => {
    const m = new Map<string, { patron_id: string; offset: number }[]>()
    for (const mi of data.miembros) {
      const p = patronPorId.get(mi.patron_id)
      if (!p || !p.activo) continue
      const arr = m.get(mi.empleado_id) ?? []
      arr.push({ patron_id: mi.patron_id, offset: mi.offset_ciclo })
      m.set(mi.empleado_id, arr)
    }
    return m
  }, [data.miembros, patronPorId])

  // ── Período y rejilla de fechas ────────────────────────────────────────────────
  // `periodo.dias` = los días del horizonte, lineales (para la vista Por persona y el
  // pie). `gridDias` = esos días alineados a semanas completas Lun→Dom (para el
  // calendario, que rellena con días de fuera del mes en los bordes).
  const periodo = useMemo(() => {
    if (!ancla) return { inicio: '', fin: '', dias: [] as string[] }
    const inicio = horizonte === 'mes' ? primerDiaMes(ancla) : lunesDe(ancla)
    const len = horizonte === 'semana' ? 7 : horizonte === 'quincena' ? 14 : diasEnMes(ancla)
    const dias = Array.from({ length: len }, (_, i) => sumarDias(inicio, i))
    return { inicio, fin: dias[dias.length - 1], dias }
  }, [ancla, horizonte])

  const fechas = periodo.dias   // la vista Por persona y el pie siguen leyendo `fechas`

  const gridDias = useMemo(() => {
    if (!periodo.dias.length) return [] as string[]
    const ini = lunesDe(periodo.inicio)
    const fin = sumarDias(lunesDe(periodo.fin), 6)   // domingo de la última semana
    return Array.from({ length: diasEntre(ini, fin) + 1 }, (_, i) => sumarDias(ini, i))
  }, [periodo])

  const etiquetaPeriodo = useMemo(() => {
    if (!ancla) return ''
    if (horizonte === 'mes') return `${MESES_LARGOS[Number(ancla.slice(5, 7)) - 1]} ${ancla.slice(0, 4)}`
    return `${fechaCorta(periodo.inicio)} – ${fechaCorta(periodo.fin)}`
  }, [ancla, horizonte, periodo])

  function navPeriodo(dir: -1 | 1) {
    if (!ancla) return
    if (horizonte === 'mes') setAncla(sumarMeses(primerDiaMes(ancla), dir))
    else setAncla(sumarDias(ancla, dir * (horizonte === 'semana' ? 7 : 14)))
  }

  /** La(s) banda(s) de trabajo de un empleado en una fecha (sin descansos). */
  function franjasDe(empleadoId: string, fecha: string): Turno[] {
    const vistos = new Set<string>()
    const out: Turno[] = []
    for (const { patron_id, offset } of patronesPorEmpleado.get(empleadoId) ?? []) {
      const p = patronPorId.get(patron_id); if (!p) continue
      const pos = posicionEnCiclo({ longitud_dias: p.longitud_dias, fecha_ancla: p.fecha_ancla, slots: [] }, offset, fecha)
      const fr = slotsResueltos.get(patron_id)?.[pos] ?? null
      if (fr && !fr.es_descanso && !vistos.has(fr.turno_id)) { vistos.add(fr.turno_id); out.push(fr) }
    }
    return out
  }

  const gentePorFecha = useMemo(
    () => fechas.map(f => empleadosVista.filter(e => franjasDe(e.empleado_id, f).length > 0).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fechas, empleadosVista, patronesPorEmpleado, slotsResueltos],
  )

  // Bandas del calendario: franjas de trabajo (sin descansos) que usa algún turno ACTIVO.
  // Así una franja huérfana (sin turno) o la de un turno desactivado no ensucia el calendario.
  const franjasCobertura = useMemo(() => {
    const ids = new Set<string>()
    const out: Turno[] = []
    for (const p of patrones) {
      if (!p.activo) continue
      for (const fr of slotsResueltos.get(p.patron_id) ?? []) {
        if (fr && !fr.es_descanso && !ids.has(fr.turno_id)) { ids.add(fr.turno_id); out.push(fr) }
      }
    }
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [patrones, slotsResueltos])

  // ── Calendario (vista de negocio): por cada día de la rejilla, quién cubre cada
  //    banda de trabajo. De aquí salen los chips del día y el modal de detalle. ──
  const calendario = useMemo(() => {
    const m = new Map<string, { porFranja: Map<string, PersonaTurno[]>; total: number }>()
    for (const f of gridDias) {
      const porFranja = new Map<string, PersonaTurno[]>()
      for (const fr of franjasCobertura) porFranja.set(fr.turno_id, [])
      const trabajan = new Set<string>()
      for (const e of empleadosVista) {
        for (const fr of franjasDe(e.empleado_id, f)) {
          const lista = porFranja.get(fr.turno_id)
          if (lista) { lista.push(e); trabajan.add(e.empleado_id) }
        }
      }
      m.set(f, { porFranja, total: trabajan.size })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDias, franjasCobertura, empleadosVista, patronesPorEmpleado, slotsResueltos])

  /** Abre el detalle del día entero: todas sus bandas de trabajo y su gente. */
  function abrirDia(f: string) {
    const info = calendario.get(f)
    setDiaModal({
      fecha: f,
      franjas: franjasCobertura.map(fr => ({ franja: fr, empleados: info?.porFranja.get(fr.turno_id) ?? [] })),
    })
  }

  // ── Derivaciones de un turno (patrón) para la lista y el modal ───────────────────
  /** Bandas horarias distintas (sin descanso) que usa un turno, en orden de aparición. */
  function bandasDePatron(p: TurnoPatron): Turno[] {
    const arr = slotsResueltos.get(p.patron_id) ?? []
    const seen = new Set<string>(); const out: Turno[] = []
    for (const fr of arr) if (fr && !fr.es_descanso && !seen.has(fr.turno_id)) { seen.add(fr.turno_id); out.push(fr) }
    return out
  }
  /** Posiciones del ciclo que se trabajan (hay banda y no es descanso). */
  function posicionesTrabajadas(p: TurnoPatron): number[] {
    const arr = slotsResueltos.get(p.patron_id) ?? []
    const out: number[] = []
    for (let i = 0; i < arr.length; i++) { const fr = arr[i]; if (fr && !fr.es_descanso) out.push(i) }
    return out
  }
  /** Resumen «cuándo se trabaja» para la tabla de turnos. */
  function resumenCuando(p: TurnoPatron): string {
    const t = posicionesTrabajadas(p)
    if (!t.length) return '—'
    if (p.tipo === 'SEMANAL') return rangoDias(t)
    if (p.tipo === 'CICLO')   return `Ciclo ${t.length}×${Math.max(0, p.longitud_dias - t.length)}`
    const etq = p.tipo === 'QUINCENAL' ? 'Quincenal' : 'Mensual'
    return `${etq} · ${t.length} de ${p.longitud_dias} días`
  }
  /** Valores iniciales del modal al editar un turno existente. */
  function seedDePatron(p: TurnoPatron): SeedTurno {
    const bandas = bandasDePatron(p)
    const primary = bandas[0] ?? null
    const t = posicionesTrabajadas(p)
    const roster: [string, number][] = []
    for (const mi of data.miembros) if (mi.patron_id === p.patron_id) roster.push([mi.empleado_id, mi.offset_ciclo])
    const esSimple = p.tipo === 'SEMANAL'
    const onCiclo = t.length || 1
    return {
      nombre:     p.nombre,
      color:      primary?.color ?? TURNO_COLORS[0].value,
      horaInicio: formatHora(primary?.hora_inicio ?? null),
      horaFin:    formatHora(primary?.hora_fin ?? null),
      franjaId:   primary?.turno_id ?? '',
      modo:       esSimple ? 'simple' : 'avanzado',
      tipo:       (esSimple ? 'QUINCENAL' : p.tipo) as TipoAvanzado,
      ancla:      p.fecha_ancla,
      dias:       esSimple ? t : [],
      posiciones: !esSimple && p.tipo !== 'CICLO' ? t : [],
      cicloOn:    p.tipo === 'CICLO' ? onCiclo : 2,
      cicloOff:   p.tipo === 'CICLO' ? Math.max(0, p.longitud_dias - onCiclo) : 3,
      roster,
      multiBanda: bandas.length > 1,
    }
  }
  const seedNuevo: SeedTurno = {
    nombre: '', color: TURNO_COLORS[0].value, horaInicio: '', horaFin: '',
    franjaId: '', modo: 'simple', tipo: 'QUINCENAL', ancla: hoy ?? '',
    dias: [0, 1, 2, 3, 4], posiciones: [], cicloOn: 2, cicloOff: 3, roster: [], multiBanda: false,
  }

  const filtroCalendarioExport = {
    empresa_id: empresaId,
    desde: periodo.inicio,
    hasta: periodo.fin,
    vista_turnos: vistaCuadrante,
    ...(vistaCuadrante === 'persona' && busqueda ? { q: busqueda } : {}),
  } as const
  const resumenCalendarioExport = [
    ...resumenEmpresa,
    etiquetaPeriodo,
    vistaCuadrante === 'persona' ? 'Por persona' : 'Calendario',
    ...(vistaCuadrante === 'persona' && busqueda ? [`Trabajador: «${busqueda}»`] : []),
  ]

  // ── Acciones ─────────────────────────────────────────────────────────────────
  function confirmarEliminarTurno() {
    if (!delTurno) return
    const banda = bandasDePatron(delTurno)[0]?.turno_id
    const patron_id = delTurno.patron_id
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarTurnoUnificado(patron_id, banda)
       await ld.dismiss()
       if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelTurno(null); return }
       toastSuccess('Turno eliminado')
       setDelTurno(null); router.refresh()
    })
  }
  function toggleTurno(p: TurnoPatron) {
    const ld = toastLoading(p.activo ? 'Desactivando…' : 'Activando…')
    startTransition(async () => {
      const res = await alternarPatron(p.patron_id, !p.activo)
       await ld.dismiss()
       if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
       toastSuccess(p.activo ? 'Turno desactivado' : 'Turno activado')
       router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Turnos</h1>
            <IaTouchpoint tipo="rrhh" descripcion="una revisión de tu cuadrante" />
          </div>
          <p className="page-subtitle">
            Crea los <strong>turnos</strong> del personal —horario, días que se trabajan y equipo— y velos
            cubiertos en el calendario.
          </p>
        </div>
        <div className="tes-header-actions">
          <ExportarMenu
            opciones={[
              { clave: 'turnos_cuadrante', etiqueta: vistaCuadrante === 'persona' ? 'Por persona' : 'Calendario',
                detalle: 'La vista y el período que estás viendo',
                filtro: filtroCalendarioExport, resumen: resumenCalendarioExport },
              { clave: 'turnos', etiqueta: 'Configuración de turnos',
                detalle: 'Rotaciones, horarios, colores y personas asignadas',
                filtro: { empresa_id: empresaId }, resumen: resumenEmpresa },
            ]}
          />
          <button className="btn btn-primary" onClick={() => setModalNuevoTurno(true)} disabled={!empresaId}>
            <Plus size={14} strokeWidth={2.5} /> Nuevo turno
          </button>
        </div>
      </div>

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear turnos necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      <div className="ter-toolbar">
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={empresaId}
            aria-label="Empresa del cuadrante"
            onChange={e => navegar({ empresa: e.target.value })}>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
      </div>

      {/* ── Turnos ── */}
      <div className="card card-table rrhh-card-gap">
        <div className="ter-card-head"><span className="ter-form-section-title">Turnos</span></div>
        {patrones.length === 0 ? (
          <div className="mon-empty">
            <Repeat size={36} strokeWidth={1} opacity={0.2} />
            <p>Crea tu primer turno: su horario, los días que se trabaja y quién lo cubre. Para rotaciones
              (2×3, semanas que alternan) marca «Rotación avanzada».</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Turno</th><th>Horario</th><th>Cuándo</th>
                  <th className="col-num">Personas</th><th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {patrones.map(p => {
                  const bandas = bandasDePatron(p)
                  const primary = bandas[0]
                  const multi = bandas.length > 1
                  return (
                    <tr key={p.patron_id}>
                      <td data-label="Turno">
                        <div className="turno-name">
                          {primary?.color && <span className="turno-dot" style={{ '--turno-color': primary.color } as React.CSSProperties} />}
                          <strong>{p.nombre}</strong>
                          {p.tipo !== 'SEMANAL' && <span className="badge badge-neutral">Rotación</span>}
                          {multi && <span className="badge badge-neutral">Varias franjas</span>}
                          {!p.activo && <span className="badge badge-neutral">Desactivado</span>}
                        </div>
                      </td>
                      <td data-label="Horario" className="text-sm-muted">{multi ? 'Varias' : primary ? horario(primary) : '—'}</td>
                      <td data-label="Cuándo" className="text-sm-muted">{resumenCuando(p)}</td>
                      <td data-label="Personas" className="col-num">{miembrosPorPatron.get(p.patron_id) ?? 0}</td>
                      <td className="col-actions">
                        <RowActions>
                          <button className="row-actions-item" onClick={() => setModalTurno(p)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                          <button className="row-actions-item" onClick={() => toggleTurno(p)} disabled={isPending}>
                            <Power size={15} strokeWidth={2} /> {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button className="row-actions-item row-actions-item-danger"
                            onClick={() => setDelTurno(p)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                        </RowActions>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Calendario ── */}
      <div className="card card-table">
        <div className="ter-card-head turno-preview-head">
          <div className="turno-nav">
            <button type="button" className="turno-nav-hoy" onClick={() => setAncla(hoy)}
              disabled={!hoy || ancla === hoy}>Hoy</button>
            <button type="button" className="turno-nav-btn" aria-label="Período anterior"
              onClick={() => navPeriodo(-1)} disabled={!ancla}><ChevronLeft size={16} strokeWidth={2} /></button>
            <span className="turno-nav-label">{etiquetaPeriodo}</span>
            <button type="button" className="turno-nav-btn" aria-label="Período siguiente"
              onClick={() => navPeriodo(1)} disabled={!ancla}><ChevronRight size={16} strokeWidth={2} /></button>
          </div>
          <div className="turno-preview-controls">
            <form className={`ter-search-wrap${vistaCuadrante === 'persona' ? '' : ' turno-search-placeholder'}`}
              aria-hidden={vistaCuadrante !== 'persona'} onSubmit={e => e.preventDefault()}>
                <div className="turno-search-field">
                  <Search size={16} strokeWidth={2} />
                  <input className="ter-search" type="search" value={textoBusqueda}
                    placeholder="Buscar trabajador…" aria-label="Buscar trabajador en Por persona"
                    disabled={vistaCuadrante !== 'persona'}
                    onChange={e => buscarTrabajador(e.target.value)} />
                  {textoBusqueda && vistaCuadrante === 'persona' && (
                    <button type="button" className="turno-search-clear"
                      onClick={() => buscarTrabajador('')}
                      aria-label="Quitar la búsqueda">
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
            </form>
            <div className="turno-horizonte" role="tablist" aria-label="Vista del calendario">
              <button type="button" role="tab" aria-selected={vistaCuadrante === 'calendario'}
                className={`turno-horizonte-btn${vistaCuadrante === 'calendario' ? ' turno-horizonte-on' : ''}`}
                onClick={() => setVistaCuadrante('calendario')}>Calendario</button>
              <button type="button" role="tab" aria-selected={vistaCuadrante === 'persona'}
                className={`turno-horizonte-btn${vistaCuadrante === 'persona' ? ' turno-horizonte-on' : ''}`}
                onClick={() => setVistaCuadrante('persona')}>Por persona</button>
            </div>
            <div className="turno-horizonte" role="tablist" aria-label="Horizonte del calendario">
              {HORIZONTES.map(h => (
                <button key={h.value} type="button" role="tab" aria-selected={horizonte === h.value}
                  className={`turno-horizonte-btn${horizonte === h.value ? ' turno-horizonte-on' : ''}`}
                  onClick={() => setHorizonte(h.value)}>{h.label}</button>
              ))}
            </div>
          </div>
        </div>
        {isSearchPending ? (
          <div className="mon-empty">
            <span className="spinner spinner-sm" />
            <p>Buscando trabajadores…</p>
          </div>
        ) : empleadosVista.length === 0 || patrones.length === 0 || !hoy ? (
          <div className="mon-empty">
            <Users size={36} strokeWidth={1} opacity={0.2} />
            <p>{!hoy ? 'Cargando…'
              : patrones.length === 0 ? 'Crea un turno y mete a su gente para ver el calendario.'
              : busqueda ? 'Ningún trabajador coincide con la búsqueda.'
              : 'No hay trabajadores activos en esta empresa.'}</p>
          </div>
        ) : vistaCuadrante === 'calendario' ? (
          franjasCobertura.length === 0 ? (
            <div className="mon-empty">
              <Clock size={36} strokeWidth={1} opacity={0.2} />
              <p>Ningún turno activo con horario que mostrar. Crea un turno con horario y métele gente.</p>
            </div>
          ) : (
            <div className={`turno-cal turno-cal-${horizonte}`}>
              <div className="turno-cal-dow-head" aria-hidden>
                {DIAS.map(d => <span key={d.n} className="turno-cal-dow-cell">{d.label}</span>)}
              </div>
              <div className="turno-cal-grid">
                {gridDias.map(f => {
                  // En «mes» la rejilla se rellena con días de fuera del mes para cuadrar las
                  // semanas: se pintan vacíos (y en móvil se ocultan).
                  const dentro = f >= periodo.inicio && f <= periodo.fin
                  if (!dentro) return <div key={f} className="turno-cal-day turno-cal-day-out" aria-hidden />
                  const info = calendario.get(f)
                  const esHoy = f === hoy
                  return (
                    <button type="button" key={f}
                      className={`turno-cal-day${esHoy ? ' turno-cal-day-hoy' : ''}`}
                      onClick={() => abrirDia(f)}
                      aria-label={`${diaSemanaCorto(f)} ${fechaCorta(f)} · ${info?.total ?? 0} en turno`}>
                      <span className="turno-cal-daynum">
                        <span className="turno-cal-dow-inline">{diaSemanaCorto(f)}</span>
                        <span className="turno-cal-dom">{diaDelMes(f)}</span>
                      </span>
                      <span className="turno-cal-bands">
                        {franjasCobertura.map(fr => {
                          const n = info?.porFranja.get(fr.turno_id)?.length ?? 0
                          return (
                            <span key={fr.turno_id}
                              className={`turno-cal-band${n === 0 ? ' turno-cal-band-vacio' : ''}`}
                              style={fr.color ? ({ '--turno-color': fr.color } as React.CSSProperties) : undefined}>
                              <span className="turno-dot" />
                              <span className="turno-cal-band-nom">{fr.nombre}</span>
                              <span className="turno-cal-band-n">{n}</span>
                            </span>
                          )
                        })}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        ) : (
           <div className="table-wrapper turno-persona-wrap">
            <table className="table table-sticky-first turno-grid">
              <thead>
                <tr>
                  <th className="turno-grid-emp">Empleado</th>
                  {fechas.map(f => (
                    <th key={f} className="col-center turno-preview-col">
                      <span className="turno-preview-dia">{diaSemanaCorto(f)}</span>
                      <span className="turno-preview-fecha">{fechaCorta(f)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {empleadosVista.map(e => {
                  // ¿Está en algún turno activo? Si lo está, un día sin banda es un DESCANSO
                  // planificado y se marca «Libre»; si no, es que no rota y va en blanco.
                  const enPatron = (patronesPorEmpleado.get(e.empleado_id)?.length ?? 0) > 0
                  return (
                  <tr key={e.empleado_id}>
                    <td className="turno-grid-emp" data-label="Empleado">
                      <strong>{nombreDe(e)}</strong>
                      {e.cargo && <div className="text-sm-muted">{e.cargo}</div>}
                    </td>
                    {fechas.map(f => {
                      const frs = franjasDe(e.empleado_id, f)
                      const conflicto = frs.length > 1
                      const fr = frs[0]
                      return (
                        <td key={f} className={`col-center turno-preview-cell${conflicto ? ' turno-preview-conflicto' : ''}`}
                          data-label={fechaCorta(f)}
                          title={conflicto ? `Conflicto: ${frs.map(x => x.nombre).join(' y ')}` : fr?.nombre ?? (enPatron ? 'Descanso' : 'Sin turno')}>
                          {fr ? (
                            <span className="turno-preview-franja" style={fr.color ? ({ '--turno-color': fr.color } as React.CSSProperties) : undefined}>
                              {fr.color && <span className="turno-dot" />}
                              {fr.nombre}
                            </span>
                          ) : enPatron ? (
                            <span className="turno-preview-libre">Libre</span>
                          ) : <span className="text-faint">·</span>}
                          {conflicto && <span className="turno-preview-warn">!</span>}
                        </td>
                      )
                    })}
                  </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="turno-grid-emp"><strong>Gente ese día</strong></td>
                  {gentePorFecha.map((n, i) => (
                    <td key={fechas[i]} className="col-center">
                      <strong className={n === 0 ? 'text-faint' : undefined}>{n}</strong>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Modales ── */}
      {(modalNuevoTurno || modalTurno) && (
        <TurnoUnificadoModal
          key={modalTurno?.patron_id ?? 'nuevo'}
          patron={modalTurno}
          empresaId={empresaId}
          empleados={empleadosEmpresa}
          seed={modalTurno ? seedDePatron(modalTurno) : seedNuevo}
          onClose={() => { setModalNuevoTurno(false); setModalTurno(null) }}
          onSaved={() => { setModalNuevoTurno(false); setModalTurno(null); router.refresh() }} />
      )}
      {delTurno && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar turno</h2>
              <button type="button" className="modal-close" onClick={() => setDelTurno(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-body-text">
                ¿Eliminar el turno <strong>{delTurno.nombre}</strong>? Se quita su horario, su calendario y su
                equipo. Si solo quieres pausarlo, <strong>desactívalo</strong>.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDelTurno(null)}>Cancelar</button>
              <button type="button" className="btn btn-danger" onClick={confirmarEliminarTurno} disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Eliminando…</> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {diaModal && (
        <div className="modal-backdrop open">
          <div className="modal modal-md" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">{fechaLarga(diaModal.fecha)}</h2>
              <button type="button" className="modal-close" onClick={() => setDiaModal(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              {diaModal.franjas.every(fd => fd.empleados.length === 0) && (
                <p className="turno-cob-modal-sub">Ningún turno cubierto este día.</p>
              )}
              {diaModal.franjas.map(fd => (
                <div key={fd.franja.turno_id} className="turno-dia-bloque">
                  <div className="turno-dia-franja">
                    {fd.franja.color && <span className="turno-dot" style={{ '--turno-color': fd.franja.color } as React.CSSProperties} />}
                    <strong>{fd.franja.nombre}</strong>
                    <span className="text-sm-muted">{horario(fd.franja)}</span>
                    <span className={`turno-dia-cuenta${fd.empleados.length === 0 ? ' turno-dia-cuenta-cero' : ''}`}>{fd.empleados.length}</span>
                  </div>
                  {fd.empleados.length === 0 ? (
                    <p className="turno-dia-hueco">Sin cubrir</p>
                  ) : (
                    <ul className="turno-cob-modal-lista">
                      {fd.empleados.map(e => (
                        <li key={e.empleado_id} className="turno-cob-modal-item">
                          <span><strong>{nombreDe(e)}</strong>{e.cargo && <span className="text-sm-muted"> · {e.cargo}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDiaModal(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

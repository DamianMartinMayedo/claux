'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, Save } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { crearDossier, guardarBasicos, type DossierData, type DossierBasico } from '@/app/actions/portal/dossier'

// Un solo componente para crear y para editar: el wizard lo usa como pantalla 1
// y la pestaña «Mi dossier» lo abre suelto. `dossier == null` → crear.
//
// Regla del paso: una pregunta con una sola respuesta posible NO se pregunta.
// Empresa solo si tiene multiempresa Y más de una; moneda solo si tiene más de
// una activa. La mayoría de clientes ven tres campos, no seis.

// Presets de período (en cliente; el servidor tiene su propio fallback). Atajos
// bien distintos entre sí, no tres variantes de "un año". "Toda la vida" solo si
// conocemos el primer movimiento contable (lo aporta el servidor con la base).
function presets(primerMovimiento: string | null) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() // 0-based
  const dd = String(now.getDate()).padStart(2, '0')
  const iso = (yy: number, mm1: number, day: number | string) => `${yy}-${String(mm1).padStart(2, '0')}-${typeof day === 'number' ? String(day).padStart(2, '0') : day}`
  const idx = y * 12 + m - 11
  const dy = Math.floor(idx / 12), dm = (idx % 12) + 1
  const lista = [
    { clave: 'u12', label: 'Último año', desde: iso(dy, dm, 1), hasta: iso(y, m + 1, dd) },
    { clave: 'mes', label: 'Último mes', desde: iso(y, m + 1, 1), hasta: iso(y, m + 1, dd) },
  ]
  if (primerMovimiento) {
    const [py, pm] = primerMovimiento.split('-')
    lista.unshift({ clave: 'todo', label: 'Toda la vida', desde: `${py}-${pm}-01`, hasta: iso(y, m + 1, dd) })
  }
  return lista
}

export default function PasoBasicos({
  data, dossier, onListo,
}: {
  data: DossierData
  dossier: DossierBasico | null
  onListo?: () => void
}) {
  const opciones = presets(data.primerMovimiento)
  const creando = dossier === null

  // En un tenant nuevo NADA se pre-crea: sin moneda configurada no se puede crear
  // el dossier (`crearDossier` la exige, y los importes del snapshot se guardan
  // en ella). Antes se ofrecía una lista inventada USD/EUR/CUP/MLC — eso fabricaba
  // configuración que el cliente no tiene. Se avisa y se ofrece el atajo.
  const sinMoneda = data.monedas.length === 0
  const monedaDefault = dossier?.moneda_presentacion ?? data.monedaConsolidacion ?? data.monedas[0]?.codigo ?? ''

  // Defecto: "Último año" (coincide con el fallback del servidor), no "Toda la vida".
  const porDefecto = opciones.find(o => o.clave === 'u12') ?? opciones[0]
  const [titulo, setTitulo] = useState(dossier?.titulo ?? 'Dossier para inversores')
  // Correo de contacto de la portada: si el dossier no tiene uno, se PRECARGA con
  // el correo de registro (todo negocio se registra con uno) para que solo tenga
  // que confirmarlo, cambiarlo o vaciarlo.
  const [contactoEmail, setContactoEmail] = useState(dossier?.contacto_email ?? data.emailUsuario)
  const [empresaId, setEmpresaId] = useState(dossier?.empresa_id ?? '')   // '' = todas (consolidado)
  const [moneda, setMoneda] = useState(monedaDefault)
  const [desde, setDesde] = useState(dossier?.periodo_desde ?? porDefecto.desde)
  const [hasta, setHasta] = useState(dossier?.periodo_hasta ?? porDefecto.hasta)
  const [pending, startTransition] = useTransition()

  const eligeEmpresa = data.multiempresa && data.empresas.length > 1
  const eligeMoneda  = data.monedas.length > 1
  const presetActivo = opciones.find(o => o.desde === desde && o.hasta === hasta)?.clave ?? ''

  // Nombre por defecto de la portada, en vivo con la empresa elegida: la empresa
  // seleccionada, o el nombre del negocio si es consolidado (el dueño puede fijar
  // otro en «La marca» → nombre_portada, que prevalece sobre este).
  const nombrePortada = empresaId
    ? (data.empresas.find(e => e.empresa_id === empresaId)?.nombre ?? data.nombreNegocio)
    : data.nombreNegocio

  function aplicarPreset(clave: string) {
    const p = opciones.find(o => o.clave === clave)
    if (!p) return
    setDesde(p.desde); setHasta(p.hasta)
  }

  function enviar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('titulo', titulo)
      fd.set('contacto_email', contactoEmail.trim())
      if (eligeEmpresa) fd.set('empresa_id', empresaId)
      fd.set('moneda_presentacion', moneda)
      fd.set('periodo_desde', desde)
      fd.set('periodo_hasta', hasta)

      if (creando) {
        const res = await crearDossier(fd)
        if (res.ok) onListo?.()
        else toastError(res.error || 'No se pudo crear el dossier')
        return
      }

      fd.set('dossier_id', dossier.dossier_id)
      const res = await guardarBasicos(fd)
      if (res.ok) { toastSuccess('Guardado'); onListo?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  return (
    <section className="card dos-crear">
      <div className="dos-body">
        {!creando && (
          <div>
            <h2 className="dos-section-title">Lo básico</h2>
            <p className="dos-section-hint">Si cambias el período, la rejilla de números se ajusta a los meses nuevos.</p>
          </div>
        )}

        {sinMoneda && (
          <PrerequisitoAviso acciones={[{ label: 'Configurar moneda', href: '/portal/monedas' }]}>
            Para crear tu dossier necesitas <strong>al menos una moneda</strong>: es la moneda en la que le presentarás los números al inversor.
          </PrerequisitoAviso>
        )}

        <div className="dos-form-grid">
          <div className="dos-campo">
            <label className="dos-label" htmlFor="dos-titulo">¿Cómo llamamos a este dossier?</label>
            <input id="dos-titulo" className="input" value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={120} />
            <p className="dos-section-hint">Solo lo ves tú; no aparece en la presentación.</p>
          </div>

          <div className="dos-campo">
            <label className="dos-label" htmlFor="dos-contacto-email">Correo de contacto</label>
            <input
              id="dos-contacto-email" type="email" className="input" value={contactoEmail}
              onChange={e => setContactoEmail(e.target.value)} maxLength={160}
              placeholder="hola@tunegocio.com" spellCheck={false} autoComplete="off"
            />
            <p className="dos-section-hint">Aparece bajo el «Muchas gracias» del enlace. Cámbialo o déjalo vacío.</p>
          </div>

          {eligeEmpresa && (
            <div className="dos-campo">
              <label className="dos-label" htmlFor="dos-empresa">¿De qué empresa?</label>
              <select id="dos-empresa" className="input" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                <option value="">Todas (consolidado)</option>
                {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
              </select>
              <p className="dos-section-hint">
                En la portada, el inversor verá <strong>{nombrePortada}</strong>
                {empresaId ? '' : ' (el nombre del negocio, porque es consolidado)'}. Puedes cambiarlo en «La marca».
              </p>
            </div>
          )}

          {eligeMoneda && (
            <div className="dos-campo">
              <label className="dos-label" htmlFor="dos-moneda">¿En qué moneda lo presentas?</label>
              <select id="dos-moneda" className="input" value={moneda} onChange={e => setMoneda(e.target.value)}>
                {data.monedas.map(m => <option key={m.codigo} value={m.codigo}>{m.codigo}</option>)}
              </select>
            </div>
          )}

          <div className="dos-campo dos-col-full">
            <span className="dos-label">¿Qué período cubre?</span>
            <div className="dos-presets">
              {opciones.map(o => (
                <button key={o.clave} type="button"
                  className={`dos-preset${presetActivo === o.clave ? ' is-activo' : ''}`}
                  onClick={() => aplicarPreset(o.clave)}>
                  {o.label}
                </button>
              ))}
            </div>
            <div className="dos-fechas">
              <input className="input" type="date" value={desde} onChange={e => setDesde(e.target.value)} aria-label="Desde" />
              <span className="dos-fechas-sep">–</span>
              <input className="input" type="date" value={hasta} onChange={e => setHasta(e.target.value)} aria-label="Hasta" />
            </div>
          </div>
        </div>

        <div className="dos-acciones">
          <button className="btn btn-primary" onClick={enviar} disabled={pending || sinMoneda}>
            {pending
              ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" />
              : creando ? <Plus size={14} strokeWidth={2.5} /> : <Save size={14} strokeWidth={2.5} />}
            {creando ? 'Crear dossier' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </section>
  )
}

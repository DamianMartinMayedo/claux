'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Copy, Check, RefreshCw } from 'lucide-react'
import { guardarConfigCaja, regenerarToken, type CajaConfigData } from '@/app/actions/portal/caja'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

export default function CajaConfigView({ data }: { data: CajaConfigData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [nombre, setNombre]       = useState(data.caja.nombre)
  const [almacenId, setAlmacenId] = useState(data.caja.almacen_id ?? '')
  const [monedas, setMonedas]     = useState<string[]>(data.caja.monedas_aceptadas ?? [])
  const [cuentas, setCuentas]     = useState<Record<string, string>>(data.caja.cuentas_moneda ?? {})
  const [token, setToken]         = useState(data.caja.sync_token)
  const [copied, setCopied]       = useState(false)

  // En cliente usa el origen real; en SSR cae a baseUrl y se resuelve al hidratar
  // (el input lleva suppressHydrationWarning por el value distinto server/cliente).
  const base = typeof window !== 'undefined' ? window.location.origin : data.baseUrl
  const installUrl = `${base}/caja#t=${token}`

  const empresaAlmacenes = data.almacenes.filter(a => a.empresa_id === data.caja.empresa_id)
  const cuentasDe = (moneda: string) =>
    data.cuentas.filter(c => c.empresa_id === data.caja.empresa_id && c.moneda === moneda)

  function toggleMoneda(m: string) {
    setMonedas(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  function copiar() {
    navigator.clipboard?.writeText(installUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }

  function regenerar() {
    startTransition(async () => {
      const r = await regenerarToken(data.caja.caja_id)
      if (!r.ok || !r.token) { toastError(r.error ?? 'No se pudo regenerar el enlace.'); return }
      setToken(r.token)
      toastSuccess('Enlace regenerado. Reinstala la caja con el nuevo enlace.')
    })
  }

  function guardar(e: FormEvent) {
    e.preventDefault()
    const cuentasFiltradas: Record<string, string> = {}
    for (const m of monedas) if (cuentas[m]) cuentasFiltradas[m] = cuentas[m]
    startTransition(async () => {
      const r = await guardarConfigCaja(data.caja.caja_id, {
        nombre, almacen_id: almacenId || null, monedas_aceptadas: monedas, cuentas_moneda: cuentasFiltradas,
      })
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar.'); return }
      toastSuccess('Configuración guardada.')
      router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <Link href="/portal/caja" className="link-inherit caja-install-hint">
            <ArrowLeft size={13} strokeWidth={2} /> Cajas
          </Link>
          <h1 className="page-title">{data.caja.nombre}</h1>
          <p className="page-subtitle">Instalación y configuración de la caja.</p>
        </div>
      </div>

      {/* ── Instalación ── */}
      <div className="card caja-config-section">
        <h2 className="mon-section-title">Instalar en un dispositivo</h2>
        <p className="caja-install-hint">
          Abre este enlace UNA vez con conexión en el móvil o tablet que será la caja e instálala
          («Añadir a inicio»). Después funciona sin conexión.
        </p>
        <div className="caja-install">
          <div className="caja-link-row">
            <input className="input caja-link-field" readOnly value={installUrl} suppressHydrationWarning
              onFocus={e => e.currentTarget.select()} aria-label="Enlace de instalación" />
            <button type="button" className="btn btn-secondary" onClick={copiar}>
              {copied ? <><Check size={14} strokeWidth={2} /> Copiado</> : <><Copy size={14} strokeWidth={2} /> Copiar</>}
            </button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={regenerar} disabled={isPending}>
            <RefreshCw size={14} strokeWidth={2} /> Regenerar enlace (invalida el anterior)
          </button>
        </div>
      </div>

      {/* ── Configuración ── */}
      <form className="card" onSubmit={guardar}>
        <h2 className="mon-section-title">Configuración</h2>

        <div className="input-group">
          <label htmlFor="cfg-nombre">Nombre <span className="required">*</span></label>
          <input id="cfg-nombre" className="input" value={nombre} onChange={e => setNombre(e.target.value)} />
        </div>

        {data.tieneInventario ? (
          <div className="input-group">
            <label htmlFor="cfg-almacen">Almacén <span className="label-hint">(de dónde descuenta stock)</span></label>
            <select id="cfg-almacen" className="input" value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
              <option value="">— Sin descuento de stock —</option>
              {empresaAlmacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
            </select>
          </div>
        ) : (
          <p className="caja-install-hint">
            Sin módulo Inventario: la caja no descuenta stock (los productos se teclean a mano en el dispositivo).
          </p>
        )}

        <div className="input-group">
          <label>Monedas aceptadas{data.tieneBase ? ' y su caja en Tesorería' : ''}</label>
          {data.monedas.length === 0 ? (
            <p className="caja-install-hint">No hay monedas activas. Configúralas en «Monedas y tasas».</p>
          ) : (
            <div className="caja-moneda-list">
              {data.monedas.map(m => {
                const checked = monedas.includes(m)
                return (
                  <div key={m} className="caja-moneda-row">
                    <label className="caja-moneda-check">
                      <input type="checkbox" checked={checked} onChange={() => toggleMoneda(m)} /> {m}
                    </label>
                    {checked && data.tieneBase && (
                      <select className="input" value={cuentas[m] ?? ''}
                        onChange={e => setCuentas(prev => ({ ...prev, [m]: e.target.value }))}>
                        <option value="">— Cuenta de caja ({m}) —</option>
                        {cuentasDe(m).map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre}</option>)}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!data.tieneBase && (
            <p className="caja-install-hint">
              Sin módulo Contabilidad: las ventas no se registran en Tesorería (quedan solo en el detalle de la caja).
            </p>
          )}
        </div>

        <div className="caja-actions">
          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </div>
  )
}

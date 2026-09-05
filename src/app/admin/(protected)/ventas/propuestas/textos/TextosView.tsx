'use client'

import { useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarSetting } from '@/app/actions/settings'
import PropuestasTabs from '@/components/admin/PropuestasTabs'
import { CLAVES_AJUSTES, tarjetasComoJson } from '@/lib/propuesta/ajustes'
import type { RolAdmin, SeccionKey } from '@/lib/roles'
import type { Tarjeta } from '@/lib/propuesta/tipos'

export interface TextosPropuesta {
  queEs:     Tarjeta[]
  problema:  string[]
  confianza: Tarjeta[]
  empecemos: Tarjeta[]
  pago:      string
}

/**
 * Las cuatro diapositivas que no hablan del cliente, más el reparto del pago.
 *
 * Una tarjeta por diapositiva, y cada una dice a cuál alimenta: cinco grupos
 * seguidos en una sola columna no dejaban ver qué se estaba tocando.
 */
export default function TextosView({ textos, rol, permisos }: {
  textos: TextosPropuesta
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  // Lo guardado, para saber qué ha cambiado. Se actualiza al guardar: sin eso,
  // el botón se queda encendido con lo que ya está en la base de datos.
  const [base, setBase] = useState(textos)
  const [queEs, setQueEs] = useState<Tarjeta[]>(textos.queEs)
  const [problema, setProblema] = useState(textos.problema.join('\n'))
  const [confianza, setConfianza] = useState<Tarjeta[]>(textos.confianza)
  const [empecemos, setEmpecemos] = useState<Tarjeta[]>(textos.empecemos)
  const [pago, setPago] = useState(textos.pago)
  const [loading, setLoading] = useState(false)

  // Se guarda solo lo que ha cambiado, como en los textos legales: así editar una
  // tarjeta no reescribe los otros cuatro ajustes ni los deja en el log.
  const pares = [
    { key: CLAVES_AJUSTES.queEs,     value: tarjetasComoJson(queEs),     antes: tarjetasComoJson(base.queEs) },
    { key: CLAVES_AJUSTES.problema,  value: problema.trim(),             antes: base.problema.join('\n') },
    { key: CLAVES_AJUSTES.confianza, value: tarjetasComoJson(confianza), antes: tarjetasComoJson(base.confianza) },
    { key: CLAVES_AJUSTES.empecemos, value: tarjetasComoJson(empecemos), antes: tarjetasComoJson(base.empecemos) },
    { key: CLAVES_AJUSTES.pago,      value: pago.trim(),                 antes: base.pago },
  ]
  const cambiados = pares.filter(p => p.value !== p.antes)

  async function guardar() {
    if (cambiados.length === 0 || loading) return
    setLoading(true)
    const res = await Promise.all(cambiados.map(p => guardarSetting(p.key, p.value)))
    setLoading(false)
    if (res.some(r => !r.ok)) { toastError('No se pudo guardar algún texto.'); return }
    setBase({
      queEs, confianza, empecemos,
      problema: problema.trim().split('\n'),
      pago: pago.trim(),
    })
    toastSuccess(
      cambiados.length === 1
        ? 'Texto guardado. Las propuestas ya lo enseñan'
        : `${cambiados.length} textos guardados. Las propuestas ya los enseñan`,
    )
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Textos de la presentación</h1>
          <p className="page-subtitle">
            Salen igual en todas las propuestas. Un grupo vacío vuelve al texto del sistema.
          </p>
        </div>
        <button className="btn btn-primary" disabled={loading || cambiados.length === 0} onClick={guardar}>
          {loading
            ? <><span className="spinner" /> Guardando…</>
            : <><Save size={16} strokeWidth={2} /> {cambiados.length === 0 ? 'Guardado' : 'Guardar'}</>}
        </button>
      </div>

      <PropuestasTabs rol={rol} permisos={permisos} />

      <div className="prp-panel">
        <Tarjetas
          titulo="¿Qué es CLAUX?" prefijo="prt-quees"
          ayuda="Qué es esto, en tres o cuatro ideas."
          tarjetas={queEs} onChange={setQueEs}
        />

        <div className="card">
          <h2 className="card-title card-title-sm">El problema que resuelve</h2>
          <div className="input-group">
            <label htmlFor="prt-problema">Con CLAUX</label>
            <span className="input-hint">
              Un punto por línea. La columna de enfrente —cómo trabaja hoy— se escribe en
              cada propuesta.
            </span>
            <textarea
              id="prt-problema" className="input" rows={6} value={problema}
              onChange={e => setProblema(e.target.value)}
            />
          </div>
        </div>

        <Tarjetas
          titulo="Por qué confiar en CLAUX" prefijo="prt-confianza"
          ayuda="Donde se promete que los datos no se comparten."
          tarjetas={confianza} onChange={setConfianza}
        />

        <Tarjetas
          titulo="Empecemos" prefijo="prt-empecemos"
          ayuda="Los pasos, en orden."
          tarjetas={empecemos} onChange={setEmpecemos}
        />

        <div className="card">
          <h2 className="card-title card-title-sm">Cómo se configura</h2>
          <div className="input-group">
            <label htmlFor="prt-pago">Reparto del pago de la instalación</label>
            <span className="input-hint">Cada propuesta puede cambiarlo; esto es con lo que arranca.</span>
            <textarea
              id="prt-pago" className="input" rows={3} value={pago}
              onChange={e => setPago(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Una diapositiva de tarjetas «título + cuerpo», con añadir y quitar. */
function Tarjetas({ titulo, ayuda, prefijo, tarjetas, onChange }: {
  titulo: string; ayuda: string; prefijo: string
  tarjetas: Tarjeta[]
  onChange: (t: Tarjeta[]) => void
}) {
  function editar(i: number, campo: 'titulo' | 'cuerpo', valor: string) {
    onChange(tarjetas.map((t, k) => (k === i ? { ...t, [campo]: valor } : t)))
  }

  return (
    <div className="card">
      <h2 className="card-title card-title-sm">{titulo}</h2>
      <p className="text-sm-muted">{ayuda}</p>
      <div className="prt-grupo">
        {tarjetas.map((t, i) => (
          <div key={i} className="prt-tarjeta">
            <div className="prt-tarjeta-campos">
              <input
                id={`${prefijo}-t-${i}`} className="input" value={t.titulo}
                placeholder="Título" aria-label={`Título de la tarjeta ${i + 1}`}
                onChange={e => editar(i, 'titulo', e.target.value)}
              />
              <textarea
                id={`${prefijo}-c-${i}`} className="input" rows={2} value={t.cuerpo}
                placeholder="Cuerpo" aria-label={`Texto de la tarjeta ${i + 1}`}
                onChange={e => editar(i, 'cuerpo', e.target.value)}
              />
            </div>
            <button
              type="button" className="btn-icon btn-icon-danger"
              aria-label={`Quitar la tarjeta ${i + 1}`}
              onClick={() => onChange(tarjetas.filter((_, k) => k !== i))}
            >
              <Trash2 size={15} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <div className="prt-acciones">
        <button
          type="button" className="btn btn-secondary btn-sm"
          onClick={() => onChange([...tarjetas, { titulo: '', cuerpo: '' }])}
        >
          <Plus size={14} strokeWidth={2} /> Añadir
        </button>
        {tarjetas.length === 0 && (
          <span className="input-hint">Sin ninguna, se enseñan las que trae el sistema.</span>
        )}
      </div>
    </div>
  )
}

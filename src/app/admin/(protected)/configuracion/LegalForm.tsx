'use client'

import { useState } from 'react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarSetting } from '@/app/actions/settings'
import { AYUDA_FORMATO, PAGINAS_LEGALES } from '@/lib/publico/legal'

type Props = {
  /** Texto actual de cada página, por slug. */
  textos: Record<string, string>
}

const SLUGS = Object.keys(PAGINAS_LEGALES)

export default function LegalForm({ textos }: Props) {
  const [valores, setValores] = useState<Record<string, string>>(textos)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Se guarda solo lo que ha cambiado: así una edición no reescribe (ni deja
    // en el log de actividad) las otras dos páginas.
    const cambiados = SLUGS.filter((s) => valores[s] !== textos[s])
    const res = await Promise.all(
      cambiados.map((s) => guardarSetting(PAGINAS_LEGALES[s].clave, valores[s] ?? '')),
    )
    setLoading(false)

    if (cambiados.length === 0) { toastSuccess('No hay cambios que guardar'); return }
    if (res.some((r) => !r.ok)) { toastError('No se pudo guardar algún texto.'); return }
    toastSuccess(
      cambiados.length === 1
        ? `«${PAGINAS_LEGALES[cambiados[0]].titulo}» guardado y publicado`
        : `${cambiados.length} textos guardados y publicados`,
    )
  }

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <span className="input-hint">{AYUDA_FORMATO}</span>

      {SLUGS.map((slug) => (
        <div key={slug} className="input-group">
          <label htmlFor={`legal-${slug}`}>{PAGINAS_LEGALES[slug].titulo}</label>
          <textarea
            id={`legal-${slug}`}
            className="input legal-textarea"
            rows={10}
            value={valores[slug] ?? ''}
            onChange={(e) => setValores((v) => ({ ...v, [slug]: e.target.value }))}
            placeholder={`Texto de «${PAGINAS_LEGALES[slug].titulo}». Vacío = la página avisa de que está en preparación.`}
          />
          <span className="input-hint">
            Se publica en{' '}
            <a href={`/legal/${slug}`} target="_blank" rel="noopener noreferrer" className="legal-hint-link">
              /legal/{slug}
            </a>
          </span>
        </div>
      ))}

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando…</> : 'Guardar textos legales'}
      </button>
    </form>
  )
}

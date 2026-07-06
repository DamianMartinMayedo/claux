'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { comprimirImagen } from '@/lib/imagen/comprimir'

// Componente reutilizable de subida de imagen con previsualización. Pre-comprime
// en el navegador (ahorra datos móviles) y entrega un File listo para subir; el
// servidor lo re-optimiza con sharp (garantía uniforme). No sube por sí mismo:
// el padre decide cuándo (onChange entrega el File; onRemove pide quitar la actual).
//
// La previsualización se pinta como custom property (--preview), única excepción
// al no-inline permitida por la skill de UI (valor de runtime).
export default function ImageUpload({
  valorInicial, onChange, onRemove, disabled, label = 'Foto',
}: {
  valorInicial?: string | null
  onChange: (file: File | null) => void
  onRemove?: () => void
  disabled?: boolean
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(valorInicial ?? null)
  const [procesando, setProcesando] = useState(false)

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    setProcesando(true)
    try {
      const blob = await comprimirImagen(file)
      const comprimido = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: blob.type || 'image/webp' })
      setPreview(URL.createObjectURL(comprimido))
      onChange(comprimido)
    } finally {
      setProcesando(false)
    }
  }

  function quitar() {
    setPreview(null)
    onChange(null)
    onRemove?.()
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="img-upload">
      <input
        ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp"
        className="img-upload-input" onChange={elegir} disabled={disabled || procesando}
        aria-label={`Seleccionar ${label.toLowerCase()}`}
      />
      <button
        type="button" className="img-upload-drop"
        onClick={() => inputRef.current?.click()} disabled={disabled || procesando}
        {...(preview ? { 'data-has-preview': 'true' } : {})}
      >
        {preview
          ? <span className="img-upload-preview" style={{ '--preview': `url(${preview})` } as React.CSSProperties} />
          : <span className="img-upload-placeholder">
              {procesando ? <Loader2 size={22} strokeWidth={2} className="img-upload-spin" /> : <ImagePlus size={22} strokeWidth={2} />}
              <span>{procesando ? 'Optimizando…' : `Añadir ${label.toLowerCase()}`}</span>
            </span>}
      </button>
      {preview && !disabled && (
        <button type="button" className="btn btn-danger btn-sm img-upload-remove" onClick={quitar}>
          <Trash2 size={14} strokeWidth={2} /> Quitar
        </button>
      )}
    </div>
  )
}

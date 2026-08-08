'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Download, Loader2, QrCode } from 'lucide-react'
import { toastError } from '@/app/contexts/ToastContext'

/**
 * QR de un enlace público del negocio, con su descarga en PNG.
 *
 * Estaba escrito a mano dentro de `CatalogoEditor` y Reservas y Citas no lo tenían,
 * aunque el QR es justo cómo se reparte un enlace en una mesa, un mostrador o un
 * escaparate. Al promoverlo a componente lo usan los tres sitios.
 *
 * `qrcode` se carga con `import()` dinámico a propósito: es una librería que solo hace
 * falta si el dueño pulsa el botón, y el portal no puede pagarla en cada carga.
 */
export default function QrEnlace({ url, nombreArchivo, titulo = 'Código QR' }: {
  /** Sin enlace no hay QR: el componente no pinta nada (aún no hay slug). */
  url:            string | null
  /** Sin extensión; se descarga como `<nombreArchivo>.png`. */
  nombreArchivo:  string
  titulo?:        string
}) {
  const [dataUrl, setDataUrl]   = useState('')
  const [generando, setGenerando] = useState(false)

  async function generar() {
    if (!url) return
    setGenerando(true)
    try {
      const QRCode = (await import('qrcode')).default
      setDataUrl(await QRCode.toDataURL(url, { width: 480, margin: 2 }))
    } catch {
      toastError('No se pudo generar el QR.')
    } finally {
      setGenerando(false)
    }
  }

  function descargar() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${nombreArchivo}.png`
    a.click()
  }

  if (!url) return null

  return (
    <div className="card cat-qr-card">
      <div className="card-header"><h2 className="card-title">{titulo}</h2></div>
      {dataUrl ? (
        <div className="cat-qr-preview">
          <Image src={dataUrl} alt={`QR de ${url}`} width={220} height={220} unoptimized />
          <button type="button" className="btn btn-secondary" onClick={descargar}>
            <Download size={16} strokeWidth={2} /> Descargar PNG
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={generar} disabled={generando}>
          {generando ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <QrCode size={16} strokeWidth={2} />}
          Generar QR
        </button>
      )}
    </div>
  )
}

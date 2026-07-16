'use client'

import { useMemo, useState, useTransition } from 'react'
import type { CSSProperties } from 'react'
import { Loader2, Save, Copy, Check } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import ImageUpload from '@/components/ImageUpload'
import {
  guardarMarca, subirLogoDossier, quitarLogoDossier, usarLogoEmpresa,
  type DossierBasico,
} from '@/app/actions/portal/dossier'
import { derivarPaleta, normalizarHex, contraste, paletaVars } from '@/lib/dossier/paleta'

// El color y el logo son del DOSSIER, no del negocio: `empresas.color` es la
// paleta cerrada de 8 que identifica filas en las tablas del portal, no es marca.
// De un color se deriva la paleta entera con contraste GARANTIZADO — por eso el
// preview enseña el color ya ajustado, no el que se tecleó.

// Gama curada: colores ricos que rinden como portada de deck (texto blanco sobre
// color). `derivarPaleta` garantiza ≥4.5:1 en todos — se oscurecen lo justo si
// hace falta. El teal de marca va primero (coincide con el color por defecto).
const SUGERIDOS = ['#00AFAA', '#2563EB', '#4F46E5', '#059669', '#B45309', '#DC2626', '#7C3AED', '#0F172A']

export default function PasoMarca({
  dossier, empresaLogoUrl, nombrePorDefecto, onGuardado, onCambio,
}: {
  dossier: DossierBasico
  empresaLogoUrl: string | null
  nombrePorDefecto: string
  // OJO: son DOS cosas distintas y confundirlas rompe el paso.
  //   · onGuardado = «este paso está terminado» → en el wizard AVANZA. Solo lo
  //     llama el botón «Guardar marca», que es lo único que persiste color y nombre.
  //   · onCambio   = «algo se guardó por su cuenta, refresca» → el logo, que tiene
  //     su propia acción y se sube al instante.
  // El logo llamaba a onGuardado: en el wizard eso te empujaba a la pantalla final
  // nada más subirlo, y como el botón «Guardar marca» ya no llegabas a pulsarlo, el
  // color y el nombre de portada elegidos NO se guardaban nunca.
  onGuardado?: () => void
  onCambio?: () => void
}) {
  const [hex, setHex] = useState(dossier.color_principal || '#00AFAA')
  const [nombrePortada, setNombrePortada] = useState(dossier.nombre_portada ?? '')
  const [logoUrl, setLogoUrl] = useState(dossier.logo_url)
  const [pending, startTransition] = useTransition()
  const [subiendo, startSubida] = useTransition()

  const normalizado = normalizarHex(hex)
  const paleta = useMemo(() => derivarPaleta(normalizado), [normalizado])
  // Si el color elegido no era legible, `derivarPaleta` lo desplazó: díselo.
  const ajustado = paleta.principal !== normalizado
  const ratio = contraste(paleta.principal, paleta.principalTexto)

  function guardar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('color_principal', normalizado)
      fd.set('nombre_portada', nombrePortada.trim())
      const res = await guardarMarca(fd)
      if (res.ok) { toastSuccess('Marca guardada'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  function subirLogo(file: File | null) {
    if (!file) return
    startSubida(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('logo', file)
      const res = await subirLogoDossier(fd)
      if (res.ok) { setLogoUrl(res.logo_url ?? null); toastSuccess('Logo subido'); onCambio?.() }
      else toastError(res.error || 'No se pudo subir el logo')
    })
  }

  function quitarLogo() {
    startSubida(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await quitarLogoDossier(fd)
      if (res.ok) { setLogoUrl(null); onCambio?.() }
      else toastError(res.error || 'No se pudo quitar el logo')
    })
  }

  function copiarDeEmpresa() {
    startSubida(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      const res = await usarLogoEmpresa(fd)
      if (res.ok) { setLogoUrl(res.logo_url ?? null); toastSuccess('Logo copiado de tu empresa'); onCambio?.() }
      else toastError(res.error || 'No se pudo copiar el logo')
    })
  }

  return (
    <section className="card">
      <div className="dos-body">
        <h2 className="dos-section-title">La marca</h2>
        <p className="dos-section-hint">
          El nombre, el color y el logo son de esta presentación, no de tu negocio: cámbialos sin tocar nada más.
        </p>

        <div className="dos-campo">
          <label className="dos-label" htmlFor="dos-nombre-portada">¿Qué nombre va en la portada?</label>
          <input
            id="dos-nombre-portada" className="input" value={nombrePortada}
            onChange={e => setNombrePortada(e.target.value)} maxLength={120}
            placeholder={nombrePorDefecto} spellCheck={false}
          />
          <p className="dos-section-hint">
            Es el nombre que verá el inversor en la portada. Si lo dejas vacío, usamos <strong>{nombrePorDefecto}</strong>.
          </p>
        </div>

        <div className="dos-campo">
          <span className="dos-label">¿Cuál es tu color?</span>
          <div className="dos-colores">
            {SUGERIDOS.map(c => (
              <button
                key={c} type="button"
                className={`dos-color-chip${normalizarHex(c) === normalizado ? ' is-activo' : ''}`}
                style={{ '--do-chip': c } as CSSProperties}
                onClick={() => setHex(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <div className="dos-color-row">
            <input
              type="color" className="dos-color-input" value={normalizado}
              onChange={e => setHex(e.target.value)} aria-label="Elegir color exacto"
            />
            <input
              type="text" className="input dos-hex-input" value={hex} maxLength={7}
              onChange={e => setHex(e.target.value)} aria-label="Color en hexadecimal"
              placeholder="#00AFAA" spellCheck={false}
            />
          </div>
        </div>

        {/* Preview de la paleta derivada, en vivo */}
        <div className="dos-paleta" style={paletaVars(paleta)}>
          <div className="dos-paleta-hero">
            <span className="dos-paleta-titulo">Tu presentación</span>
            <span className="dos-paleta-sub">Así se verá la portada del enlace</span>
          </div>
          {/* La etiqueta va AL LADO del color, no encima: `derivarPaleta` solo
              garantiza contraste para el texto sobre `principal`; poner texto
              sobre el acento sería inventarse una legibilidad que nadie calculó. */}
          <div className="dos-paleta-muestras">
            <span className="dos-paleta-muestra"><span className="dos-muestra-color dos-m-principal" /> Principal</span>
            <span className="dos-paleta-muestra"><span className="dos-muestra-color dos-m-acento" /> Acento</span>
            <span className="dos-paleta-muestra"><span className="dos-muestra-color dos-m-superficie" /> Fondo</span>
          </div>
          <p className="dos-paleta-nota">
            {ajustado
              ? `Ajustamos un poco tu color (${normalizado} → ${paleta.principal}) para que el texto encima se lea. Contraste ${ratio.toFixed(1)}:1.`
              : `Contraste del texto sobre tu color: ${ratio.toFixed(1)}:1. Legible.`}
          </p>
        </div>

        <div className="dos-campo">
          <span className="dos-label">Tu logo</span>
          <p className="dos-section-hint">Opcional. Si no pones ninguno, la presentación sale solo con el nombre.</p>
          <ImageUpload
            key={logoUrl ?? 'vacio'}
            valorInicial={logoUrl}
            onChange={subirLogo}
            onRemove={quitarLogo}
            disabled={subiendo}
            label="Logo"
          />
          {!logoUrl && empresaLogoUrl && (
            <div className="dos-relato-extra">
              <button className="btn btn-secondary btn-sm" onClick={copiarDeEmpresa} disabled={subiendo}>
                {subiendo ? <Loader2 size={13} strokeWidth={2.5} className="dos-spin" /> : <Copy size={13} strokeWidth={2.5} />}
                Usar el logo de mi empresa
              </button>
            </div>
          )}
          {logoUrl && (
            <p className="dos-section-hint dos-logo-ok"><Check size={13} strokeWidth={2.5} /> Logo listo.</p>
          )}
        </div>

        <div className="dos-acciones">
          <button className="btn btn-primary" onClick={guardar} disabled={pending}>
            {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
            Guardar marca
          </button>
        </div>
      </div>
    </section>
  )
}

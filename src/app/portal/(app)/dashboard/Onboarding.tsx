'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, Check, ChevronDown, Coins, Hash, Sparkles, Upload } from 'lucide-react'
import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { ocultarOnboarding, descartarImport } from '@/app/actions/portal/onboarding'
import type { OnbPaso, OnboardingData, FormPaso } from '@/lib/onboarding/pasos'
import OnboardingAnillo from './OnboardingAnillo'
import OnboardingModal from './OnboardingModal'

// Bloque de puesta en marcha. Sustituye a los avisos apilados que recibía un
// cliente nuevo («crea una empresa», «configura una moneda», «¿traes datos?»):
// aquellos decían lo que faltaba y mandaban a otra página; este lo RESUELVE en el
// sitio.
//
// Referencias: la guía de configuración de Shopify (acordeón con progreso) y el
// checklist de Stripe (anillo y desaparición al terminar). Las dos funcionan por
// lo mismo: **un solo objetivo visible a la vez**, no una lista de tareas.
//
// Son tres pasos y una pregunta —el porqué de ese recorte está en
// `lib/onboarding/pasos.ts`— y cuando no queda ninguno el bloque **desaparece**:
// `calcularOnboarding` devuelve `null`. Pero no en seco: antes se despide con la
// misma banda de marca y se retira sola. Terminar de configurar un negocio merece
// que alguien lo diga; apagarse sin más deja al dueño preguntándose si guardó.
//
// Por eso el padre lo monta SIEMPRE, también con `data` a null: la despedida la
// dispara ver que había pasos y ya no los hay, y para verlo hay que seguir vivo.
//
// Dos tamaños: banda a todo el ancho mientras falte lo básico (sin eso la app no
// hace nada y unos widgets vacíos no lo explican) y tarjeta compacta cuando solo
// queda la pregunta del importador, que no es motivo para tapar un dashboard.

const ICONOS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  moneda: Coins, empresa: Building2, letra: Hash, importar: Upload,
}

export default function Onboarding({ data }: { data: OnboardingData | null }) {
  const router = useRouter()
  const [form, setForm]           = useState<FormPaso | null>(null)
  const [verHechos, setVerHechos] = useState(false)
  const [despedida, setDespedida] = useState(false)
  // Había pasos la última vez que se pintó. Sobrevive al `router.refresh()`: el
  // refresco vuelve a pedir los datos del servidor pero no desmonta el cliente.
  const [habia, setHabia] = useState(!!data)
  // «Ocultar» también deja `data` en null, y ahí no hay nada que celebrar: el
  // dueño no ha terminado, ha dicho que no se lo enseñemos más.
  const [ocultando, setOcultando] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Estable a propósito: los temporizadores de la despedida dependen de ella y
  // con una función nueva por render se reiniciarían solos cada vez que algo
  // repinte el dashboard, y la banda no se iría nunca.
  const finDespedida = useCallback(() => setDespedida(false), [])

  // Ajuste de estado durante el render: el patrón que React documenta para
  // derivar de props (https://react.dev/reference/react/useState). Un efecto no
  // sirve aquí —dispararía un fotograma DESPUÉS y el hueco parpadearía— y
  // además la regla del compilador lo prohíbe.
  if (habia !== !!data) {
    setHabia(!!data)
    if (!data && !ocultando) setDespedida(true)
  }

  function accion(fn: () => Promise<{ ok: boolean; error?: string }>, texto: string) {
    // El toast se crea ANTES de la transición: dentro no se pinta hasta que
    // termina el refresco, y eso en Cuba son segundos de silencio tras pulsar.
    const ld = toastLoading(texto)
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }

  function onGuardado() { setForm(null); router.refresh() }

  // Sin pasos no hay bloque. Si los HABÍA hace un instante, la despedida ocupa su
  // sitio y se retira sola; si no, aquí no se pinta nada y el dashboard es el
  // dashboard.
  if (!data) return despedida ? <Despedida onFin={finDespedida} /> : null

  const { estado, pasos, hechos, total, puedeOcultar, puedeDescartarImport } = data
  const hechosLista = pasos.filter(p => p.hecho)
  const pendientes  = pasos.filter(p => !p.hecho)
  const activo      = pendientes.find(p => !p.ajeno) ?? pendientes[0]
  const siguientes  = pendientes.filter(p => p !== activo)
  const arranque    = estado === 'arranque'

  return (
    <>
      <section className={`onb${arranque ? ' onb-arranque' : ' onb-afinar'}`} aria-label="Puesta en marcha">
        <header className="onb-cabecera">
          <OnboardingAnillo hechos={hechos} total={total} compacto={!arranque} />
          <div className="onb-cabecera-txt">
            <h2 className="onb-titulo">{arranque ? 'Pon en marcha tu negocio' : 'Casi listo'}</h2>
            <p className="onb-sub">
              {pendientes.length === 1 ? 'Te queda un paso.' : `Te quedan ${pendientes.length} pasos.`}
            </p>
          </div>
          {puedeOcultar && (
            <button
              type="button" className="onb-ocultar" disabled={isPending}
              onClick={() => { setOcultando(true); accion(ocultarOnboarding, 'Ocultando…') }}
            >
              Ocultar
            </button>
          )}
        </header>

        <ol className="onb-lista">
          {/* Los hechos van arriba —son la prueba del progreso— y visibles, no
              borrados: el dueño necesita poder repasar lo que ya configuró. Con
              más de dos se pliegan para no empujar el paso activo fuera de la
              pantalla del móvil. */}
          {hechosLista.length > 2 ? (
            <li className="onb-hechos-plegados">
              <button type="button" className="onb-hechos-boton" aria-expanded={verHechos} onClick={() => setVerHechos(v => !v)}>
                <span className="onb-hechos-check" aria-hidden><Check size={13} strokeWidth={3} /></span>
                {hechosLista.length} pasos hechos
                <ChevronDown size={15} strokeWidth={2} className={`onb-chevron${verHechos ? ' is-abierto' : ''}`} />
              </button>
              <div className={`onb-plegable${verHechos ? ' is-abierto' : ''}`}>
                <div className="onb-plegable-caja">
                  <ul className="onb-sublista">
                    {hechosLista.map(p => <Fila key={p.clave} paso={p} />)}
                  </ul>
                </div>
              </div>
            </li>
          ) : (
            hechosLista.map(p => <Fila key={p.clave} paso={p} />)
          )}

          {activo && (
            <Fila
              paso={activo} activo
              onForm={activo.form ? () => setForm(activo.form as FormPaso) : undefined}
              onDescartar={activo.clave === 'importar' && puedeDescartarImport
                ? () => accion(descartarImport, 'Guardando…')
                : undefined}
              isPending={isPending}
            />
          )}
          {siguientes.map(p => <Fila key={p.clave} paso={p} />)}
        </ol>
      </section>

      {form && <OnboardingModal form={form} onClose={() => setForm(null)} onSaved={onGuardado} />}
    </>
  )
}

// ── Una fila ──────────────────────────────────────────────────────────────────
//
// Solo el paso ACTIVO lleva icono en color, línea de apoyo y botón. Los demás van
// atenuados y sin acción: cuatro filas con cuatro botones no dicen por dónde
// empezar, que es justo lo que un cliente nuevo necesita saber.
function Fila({
  paso, activo = false, onForm, onDescartar, isPending = false,
}: {
  paso:         OnbPaso
  activo?:      boolean
  onForm?:      () => void
  onDescartar?: () => void
  isPending?:   boolean
}) {
  const Icono = ICONOS[paso.clave] ?? Sparkles
  const clase = `onb-paso${paso.hecho ? ' is-hecho' : ''}${activo ? ' is-activo' : ''}${paso.ajeno ? ' is-ajeno' : ''}`

  return (
    <li className={clase}>
      <span className="onb-paso-icono" aria-hidden>
        {paso.hecho ? <Check size={16} strokeWidth={3} /> : <Icono size={16} strokeWidth={2} />}
      </span>
      <div className="onb-paso-txt">
        <span className="onb-paso-titulo">{paso.titulo}</span>
        {activo && paso.apoyo && <span className="onb-paso-apoyo">{paso.apoyo}</span>}
        {paso.ajeno && paso.nota && <span className="onb-paso-apoyo">{paso.nota}</span>}
      </div>

      {paso.hecho && <span className="onb-paso-estado">Hecho</span>}

      {activo && !paso.ajeno && (
        <div className="onb-paso-acciones">
          {onForm
            ? <button type="button" className="btn btn-primary btn-sm" onClick={onForm}>{cta(paso)}</button>
            : <Link href={paso.href} className="btn btn-primary btn-sm">{cta(paso)} <ArrowRight size={14} strokeWidth={2} /></Link>}
          {onDescartar && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDescartar} disabled={isPending}>
              Empiezo de cero
            </button>
          )}
        </div>
      )}
    </li>
  )
}

// El botón dice lo que va a pasar, no «Continuar» ni «Ir»: el dueño tiene que
// saber en qué se mete ANTES de pulsar, sobre todo cuando abre un formulario.
const CTA: Record<string, string> = {
  moneda: 'Configurar moneda', empresa: 'Crear empresa',
  letra: 'Asignar letra', importar: 'Traer mis datos',
}

function cta(paso: OnbPaso): string { return CTA[paso.clave] ?? 'Configurar' }

// ── La despedida ──────────────────────────────────────────────────────────────
// El último «Guardar» vacía la guía. Apagarla ahí, en seco, es el peor final
// posible: el bloque que llevaba días delante desaparece justo al pulsar y el
// dueño no sabe si ha terminado o si algo ha fallado. Así que el sitio que
// ocupaba lo hereda un segundo la misma banda de marca para decirlo, y se retira
// sola — sin botón de cerrar: no se le pide un clic más a quien acaba de acabar.
//
// La salida colapsa la altura además de desvanecerse, para que el dashboard suba
// en vez de dar un salto seco cuando el hueco se cierra.
function Despedida({ onFin }: { onFin: () => void }) {
  const [saliendo, setSaliendo] = useState(false)

  useEffect(() => {
    const a = setTimeout(() => setSaliendo(true), 3400)
    const b = setTimeout(onFin, 3900)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [onFin])

  return (
    <section className={`onb-fin${saliendo ? ' is-saliendo' : ''}`} role="status">
      <div className="onb-fin-cuerpo">
        <span className="onb-fin-icono" aria-hidden><Check size={26} strokeWidth={3} /></span>
        <h2 className="onb-fin-titulo">Listo, ya puedes comenzar</h2>
      </div>
    </section>
  )
}

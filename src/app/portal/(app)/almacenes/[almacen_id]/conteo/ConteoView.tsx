'use client'

// ── Pantalla de conteo físico ──
//
// El papel delante y el móvil en la mano: una fila por producto, una casilla para
// escribir lo que hay de verdad. Lo que NO hace es aplicar nada por su cuenta — el
// resumen y la confirmación van antes de tocar una sola existencia.
//
// CONTAR NO ES AJUSTAR (mig. 159). Toda línea que descuadra pide **causa**: merma,
// rotura, robo, error de registro… El ajuste que se genera hereda LA SUYA, así que la
// merma se puede sumar al mes y una caja robada no se confunde con un error de teclado.
// Sin causa no se aplica: eso es el acta de faltantes y sobrantes.
//
// El avance se guarda en el servidor **en lote y con rebote**: nunca una petición por
// tecla (sobre 3G eso es la diferencia entre usable e inservible), y siempre se dice
// cuándo se guardó por última vez, porque en Cuba el corte de luz llega sin avisar.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Save, Trash2, Upload } from 'lucide-react'
import IaSparkle from '@/components/portal/ia/IaSparkle'
import { toastError, toastSuccess, toastWarning, toastLoading } from '@/app/contexts/ToastContext'
import {
  guardarAvanceConteo, aplicarConteo, anularConteo, guardarCabeceraConteo,
  importarConteoContado,
  type ConteoDetalle,
} from '@/app/actions/portal/conteos'
import {
  MOTIVO_LABEL, MOTIVOS_FALTANTE, MOTIVOS_SOBRANTE, type MotivoTipo,
} from '@/app/actions/portal/_inventario-helpers'
import { ConfirmDialog } from '@/components/portal/Dialog'
import ExportarMenu from '@/components/portal/ExportarMenu'
import AutocompletarTexto from '@/components/portal/AutocompletarTexto'
import { useIa } from '@/components/portal/ia/IaContext'
import { interpretarConteo } from '@/app/actions/portal/ia'
import { parseNumeroEs, textoNumeroEs } from '@/lib/numeros'
import { leerParaSubir } from '@/lib/subir-archivo'
import { fmtValor } from '@/lib/inventario/valoracion'
import { ahoraEnTz, hoyEnTz } from '@/lib/fecha-tz'
import { fmtFechaEs } from '@/lib/date-utils'

/** Cada cuánto se manda el avance al servidor, como mucho. */
const REBOTE_MS = 4000

type Campo = 'texto' | 'causa' | 'nota'

export default function ConteoView({ data }: { data: ConteoDetalle }) {
  const router = useRouter()
  const { conteo, almacen, moneda } = data
  const soloLectura = conteo.estado !== 'BORRADOR'

  // Todo lo editable vive en UN ref (`vivo`) y el estado es su espejo para repintar.
  // Con tres campos por línea, leer «lo último que hay escrito» desde el temporizador
  // del rebote con el estado de React era una carrera garantizada: el ref es la verdad.
  const vivo = useRef({
    texto: Object.fromEntries(data.lineas.filter(l => l.contado != null)
      .map(l => [l.producto_id, textoNumeroEs(l.contado as number)])) as Record<string, string>,
    causa: Object.fromEntries(data.lineas.filter(l => l.motivo_tipo)
      .map(l => [l.producto_id, l.motivo_tipo as string])) as Record<string, string>,
    nota: Object.fromEntries(data.lineas.filter(l => l.nota)
      .map(l => [l.producto_id, l.nota as string])) as Record<string, string>,
  })
  const [texto, setTexto] = useState(vivo.current.texto)
  const [causa, setCausa] = useState(vivo.current.causa)
  const [nota,  setNota]  = useState(vivo.current.nota)

  // La cabecera del acta (quién contó, las notas) va por el MISMO camino que las líneas:
  // en un ref con espejo de estado. Tenía botón propio de «Guardar estos datos» y era un
  // control de más — en una pantalla donde todo lo demás se guarda solo, un campo que
  // exige pulsar algo es un campo que se pierde. Lo lee el rebote y también «Guardar y
  // salir», «Aplicar» y el flush de última hora al cambiar de página.
  const cab = useRef({ contadoPor: conteo.contado_por ?? '', notas: conteo.notas ?? '' })
  const cabSucia = useRef(false)
  const [contadoPor, setContadoPor] = useState(cab.current.contadoPor)
  const [notasActa,  setNotasActa]  = useState(cab.current.notas)

  const [soloPendientes, setSoloPendientes] = useState(false)
  const [soloSinCausa,   setSoloSinCausa]   = useState(false)
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [descartar, setDescartar] = useState(false)
  /** Aviso de causas pendientes: sale al ACTUAR, no mientras se cuenta. */
  const [avisoCausas, setAvisoCausas] = useState<null | 'aplicar' | 'salir'>(null)
  const [pending, startTransition] = useTransition()
  // Conteo dictado (solo con el addon de IA contratado).
  const { tieneIa } = useIa()
  const [dictando, setDictando] = useState(false)
  const [dictado,  setDictado]  = useState('')
  const [noReconocidos, setNoReconocidos] = useState<{ texto: string; cantidad: number }[]>([])
  // Importar la hoja rellenada a mano: lo que el archivo trajo y no se pudo colocar.
  const archivoRef = useRef<HTMLInputElement>(null)
  const [noEmparejados, setNoEmparejados] = useState<string[]>([])

  /**
   * La hoja no se abrió hoy.
   *
   * Un borrador NO caduca (contar un almacén lleva días, y es a propósito), pero eso
   * significa que se puede entrar en octubre a la hoja de septiembre con las cantidades
   * de entonces escritas. Se dice con su fecha: retomar y empezar de cero son decisiones
   * distintas y las toma el dueño, no el silencio.
   */
  const hojaVieja = !soloLectura && conteo.fecha !== hoyEnTz()

  // Qué líneas están sin mandar. En un ref y no en estado: cambia en cada tecla y no
  // tiene que repintar nada.
  const sucias = useRef<Set<string>>(new Set())
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Diferencias ──
  // La referencia es `sistema` (el stock vivo que trajo el servidor) en un borrador, y
  // lo que se AJUSTÓ de verdad en un conteo ya aplicado: el acta no reinventa la
  // diferencia, la lee del ledger.
  const difs = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of data.lineas) {
      if (soloLectura) {
        if (l.delta_aplicado != null) m.set(l.producto_id, l.delta_aplicado)
        continue
      }
      const t = (texto[l.producto_id] ?? '').trim()
      if (t === '') continue
      const d = Math.round((parseNumeroEs(t) - l.sistema) * 1000) / 1000
      if (Math.abs(d) > 0.0005) m.set(l.producto_id, d)
    }
    return m
  }, [data.lineas, texto, soloLectura])

  const sinCausa = useMemo(
    () => [...difs.keys()].filter(id => !(causa[id] ?? '')),
    [difs, causa],
  )
  // Por signo, para no ofrecer «pon causa a todos los faltantes» cuando no hay ninguno.
  const hayFaltantesSinCausa = sinCausa.some(id => (difs.get(id) ?? 0) < 0)
  const haySobrantesSinCausa = sinCausa.some(id => (difs.get(id) ?? 0) > 0)

  const lineas = useMemo(() => {
    if (soloSinCausa) return data.lineas.filter(l => sinCausa.includes(l.producto_id))
    if (soloPendientes) return data.lineas.filter(l => (texto[l.producto_id] ?? '').trim() === '')
    return data.lineas
  }, [data.lineas, soloPendientes, soloSinCausa, sinCausa, texto])

  const contadas = data.lineas.filter(l => (texto[l.producto_id] ?? '').trim() !== '').length

  const porId = useMemo(
    () => new Map(data.lineas.map(l => [l.producto_id, l])),
    [data.lineas],
  )

  /** Faltantes y sobrantes, en unidades y en dinero (si hay costes). */
  const acta = useMemo(() => {
    let faltan = 0, sobran = 0, valorFalta = 0, valorSobra = 0, sinCoste = 0
    for (const [id, d] of difs) {
      const l = porId.get(id)
      if (d < 0) faltan++; else sobran++
      if (l?.costo == null) { sinCoste++; continue }
      if (d < 0) valorFalta += Math.abs(d) * l.costo
      else       valorSobra += d * l.costo
    }
    return { faltan, sobran, valorFalta, valorSobra, sinCoste }
  }, [difs, porId])

  function programarRebote() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => mandarAvance(), REBOTE_MS)
  }

  /**
   * Manda al servidor lo que esté sin guardar.
   *
   * Tres reglas que este guardado se saltaba y costaron un «Failed to fetch» en pantalla:
   *
   *  1. **La cola se vacía al TERMINAR bien, no al empezar.** Si la petición no llega
   *     —3G que se cae, corte de luz, o salir de la página con el guardado en vuelo—,
   *     las líneas vuelven a la cola y se reintentan. Antes se marcaban como enviadas
   *     antes de saber si habían llegado: lo contado se perdía en silencio, que es el
   *     único fallo que este módulo no se puede permitir.
   *  2. **`try/catch` siempre.** Una acción de servidor que no llega LANZA, y como esto
   *     se dispara desde un temporizador, la promesa iba sin dueño: en desarrollo salta
   *     el overlay rojo y en producción sería un rechazo silencioso.
   *  3. **Al desmontar no se avisa de nada.** El navegador aborta la petición en cuanto
   *     se cambia de página; es un intento de última hora, no un error que contar.
   */
  async function enviarPendientes(silencioso = false): Promise<boolean> {
    if (soloLectura) return true

    // La cabecera primero y por separado: es otra acción (otra tabla, `conteos`) y su
    // fallo no tiene por qué tirar el guardado de lo contado, que es lo que no se puede
    // perder. Igual que las líneas, solo se marca limpia si la petición LLEGÓ.
    if (cabSucia.current) {
      try {
        const r = await guardarCabeceraConteo(conteo.conteo_id, cab.current.contadoPor, cab.current.notas)
        if (r.ok) { cabSucia.current = false; setGuardadoEn(ahoraEnTz()) }
        else if (!silencioso) toastError(r.error ?? 'No se pudieron guardar los datos del acta.')
      } catch {
        if (!silencioso) toastWarning('No hay conexión con el servidor. Lo que has escrito sigue aquí y se reintenta solo.')
      }
      if (cabSucia.current) return false
    }

    const ids = [...sucias.current]
    if (ids.length === 0) return true
    const { texto: tx, causa: cz, nota: nt } = vivo.current
    const payload = ids.map(producto_id => ({
      producto_id,
      contado:     (tx[producto_id] ?? '').trim() === '' ? null : parseNumeroEs(tx[producto_id]),
      motivo_tipo: (cz[producto_id] ?? '') || null,
      nota:        (nt[producto_id] ?? '').trim() || null,
    }))
    const devolverALaCola = () => { for (const id of ids) sucias.current.add(id) }

    try {
      const r = await guardarAvanceConteo(conteo.conteo_id, payload)
      if (!r.ok) {
        devolverALaCola()
        if (!silencioso) toastError(r.error ?? 'No se pudo guardar el avance.')
        return false
      }
      for (const id of ids) sucias.current.delete(id)
      setGuardadoEn(ahoraEnTz())
      return true
    } catch {
      devolverALaCola()
      if (!silencioso) {
        toastWarning('No hay conexión con el servidor. Lo que has escrito sigue aquí y se reintenta solo.')
      }
      return false
    }
  }

  /** Versión «dispara y olvida» para el rebote y los cambios sueltos. */
  function mandarAvance(inmediato = false, silencioso = false) {
    if (inmediato) startTransition(async () => { await enviarPendientes(silencioso) })
    else           void enviarPendientes(silencioso)
  }

  function tocar(producto_id: string, campo: Campo, valor: string) {
    if (soloLectura) return
    if (campo === 'texto' && valor.trim() !== '' && !/^\d+([.,]\d*)?$/.test(valor.trim())) return
    vivo.current = { ...vivo.current, [campo]: { ...vivo.current[campo], [producto_id]: valor } }
    if (campo === 'texto')      setTexto(vivo.current.texto)
    else if (campo === 'causa') setCausa(vivo.current.causa)
    else                        setNota(vivo.current.nota)
    sucias.current.add(producto_id)
    // La causa se guarda YA: elegir en un desplegable es una decisión cerrada, no algo
    // que se esté tecleando. El rebote existe para no mandar una petición por tecla, y
    // aquí no hay teclas — esperar 4 segundos solo abre la ventana para perderla.
    if (campo === 'causa') mandarAvance()
    else                   programarRebote()
  }

  /** Pone la misma causa a todas las diferencias del mismo signo que no tengan ninguna. */
  function causaEnLote(signo: 'falta' | 'sobra', valor: string) {
    if (!valor) return
    const objetivo = [...difs.entries()]
      .filter(([id, d]) => !(vivo.current.causa[id] ?? '') && (signo === 'falta' ? d < 0 : d > 0))
      .map(([id]) => id)
    if (objetivo.length === 0) return
    const next = { ...vivo.current.causa }
    for (const id of objetivo) { next[id] = valor; sucias.current.add(id) }
    vivo.current = { ...vivo.current, causa: next }
    setCausa(next)
    mandarAvance(true)
    toastSuccess(`${objetivo.length} ${objetivo.length === 1 ? 'diferencia' : 'diferencias'} justificadas como «${MOTIVO_LABEL[valor as MotivoTipo]}»`)
  }

  /**
   * El acta en PDF: el documento que se imprime, se firma y se archiva.
   *
   * **EL ALMACÉN ENTERO, línea a línea.** Ha llegado a ser dos cosas peores: solo los
   * descuadres (con el argumento de que 197 renglones diciendo «cuadra» no los lee nadie)
   * y luego solo lo contado. Las dos escondían lo mismo: un acta que solo enseña una parte
   * no dice si el resto se revisó o se saltó, y **lo que se quedó sin contar es justo lo
   * que hay que ir a mirar**. Así que sale todo, con las diferencias arriba y lo no
   * contado marcado y al final. Sin ningún conteo hecho, el PDF es la lista completa con
   * todo «no contado» — que es una hoja de trabajo perfectamente útil.
   */
  async function actaPdf() {
    // Lo contado: en un borrador, lo que hay escrito en pantalla; en un acta aplicada, lo
    // que quedó guardado. `contado: null` = nadie fue a ese estante, y NO es un cero.
    const filas = data.lineas
      .map(l => {
        const t = (texto[l.producto_id] ?? '').trim()
        const contado = soloLectura ? l.contado : (t === '' ? null : parseNumeroEs(t))
        return { l, contado, d: contado == null ? null : (difs.get(l.producto_id) ?? 0) }
      })
      // Descuadres primero (faltantes arriba, que es lo que hay que explicar), luego lo
      // que cuadra y al final lo no contado: eso no es un resultado del conteo, es una
      // tarea pendiente. Dentro de cada grupo, por nombre — como se recorre el estante.
      .sort((a, b) => {
        const rango = (x: typeof a) => x.d == null ? 2 : x.d === 0 ? 1 : 0
        return rango(a) - rango(b)
          || (rango(a) === 0 ? (a.d as number) - (b.d as number) : 0)
          || a.l.nombre.localeCompare(b.l.nombre, 'es')
      })

    // Descargar el acta a medias es legítimo (es un borrador), pero se dice: el PDF
    // saldrá con esas líneas marcadas como «Sin causa» y eso hay que saberlo ANTES de
    // llevárselo a alguien.
    if (sinCausa.length > 0) {
      toastWarning(`El acta sale con ${sinCausa.length} ${sinCausa.length === 1 ? 'línea sin causa' : 'líneas sin causa'}.`)
    }

    const { crearDoc, cabeceraReporte, sellarPie, MARCA, RESERVA_PIE, textoPdfSeguro } =
      await import('@/lib/pdf/documento')
    const doc   = await crearDoc()
    const pageH = doc.internal.pageSize.getHeight()
    const M = 16, right = doc.internal.pageSize.getWidth() - M
    let y = M

    const sitio = (alto: number) => { if (y + alto > pageH - RESERVA_PIE - 2) { doc.addPage(); y = M } }

    y = cabeceraReporte(doc, {
      titulo:    'Acta de conteo físico',
      izquierda: textoPdfSeguro(almacen),
      derecha:   `${fmtFechaEs(conteo.fecha)} · ${conteo.conteo_id}`,
    })

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.setTextColor(MARCA.muted[0], MARCA.muted[1], MARCA.muted[2])
    doc.text(textoPdfSeguro(`Contado por: ${conteo.contado_por || '—'}`), M, y)
    doc.text(soloLectura ? 'Aplicado' : 'Borrador', right, y, { align: 'right' })
    y += 6
    if (conteo.notas) {
      for (const linea of doc.splitTextToSize(textoPdfSeguro(conteo.notas), right - M)) {
        sitio(6); doc.text(linea, M, y); y += 5
      }
    }
    y += 4

    // Resumen: unidades y dinero. «Faltan 6» no mueve a nadie; «faltan 6 = 1.800 CUP» sí.
    // Y cuántos se contaron de cuántos hay: un acta de 40 líneas sobre un almacén de 300
    // dice algo muy distinto que una de 300, y sin el denominador no se distinguen.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.setTextColor(MARCA.dark[0], MARCA.dark[1], MARCA.dark[2])
    doc.text(
      `${contadas} de ${data.lineas.length} contados`
      + `   ·   ${acta.faltan} con faltante${moneda && acta.valorFalta > 0 ? ` (${fmtValor(acta.valorFalta, moneda)})` : ''}`
      + `   ·   ${acta.sobran} con sobrante${moneda && acta.valorSobra > 0 ? ` (${fmtValor(acta.valorSobra, moneda)})` : ''}`,
      M, y,
    )
    y += 9

    // La única razón para no imprimir la tabla es que el almacén no tenga NADA que contar.
    // Que no se haya contado todavía no lo es: entonces sale la lista entera con todo «no
    // contado», que es exactamente la hoja que hace falta para ir a contar.
    if (filas.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
      doc.setTextColor(MARCA.muted[0], MARCA.muted[1], MARCA.muted[2])
      doc.text('Este almacén no tiene ningún producto que contar.', M, y)
    } else {
      const col = { prod: M, sist: M + 92, cont: M + 116, dif: M + 140, causa: M + 160 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.setTextColor(MARCA.faint[0], MARCA.faint[1], MARCA.faint[2])
      doc.text('PRODUCTO', col.prod, y)
      doc.text('SISTEMA', col.sist, y, { align: 'right' })
      doc.text('CONTADO', col.cont, y, { align: 'right' })
      doc.text('DIFERENCIA', col.dif, y, { align: 'right' })
      doc.text('CAUSA', col.causa, y)
      y += 2
      doc.setDrawColor(MARCA.divider[0], MARCA.divider[1], MARCA.divider[2]); doc.setLineWidth(0.3)
      doc.line(M, y, right, y)
      y += 5

      for (const { l, d, contado } of filas) {
        sitio(9)
        const gris  = () => doc.setTextColor(MARCA.faint[0], MARCA.faint[1], MARCA.faint[2])
        const tinta = () => doc.setTextColor(MARCA.dark[0], MARCA.dark[1], MARCA.dark[2])
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
        tinta()
        doc.text(textoPdfSeguro(l.nombre).slice(0, 42), col.prod, y)

        // Sin contar: la fila SALE, y con el nombre y el stock del sistema, que es lo que
        // hace falta para ir a ese estante. En gris y sin diferencia — un 0 ahí diría
        // «cuadra», que es la conclusión contraria a «nadie lo ha mirado».
        if (contado == null || d == null) {
          doc.text((l.sistema).toLocaleString('es-ES'), col.sist, y, { align: 'right' })
          gris(); doc.setFontSize(8.5)
          doc.text('no contado', col.cont, y, { align: 'right' })
          doc.text('—', col.dif, y, { align: 'right' })
          doc.text('—', col.causa, y)
          tinta(); doc.setFontSize(9.5)
          y += 6
          continue
        }

        const sistema = Math.round((contado - d) * 1000) / 1000
        // La línea que cuadra no lleva causa ni la pide: no hay nada que explicar.
        const causaTxt = d === 0
          ? '—'
          : causa[l.producto_id] ? MOTIVO_LABEL[causa[l.producto_id] as MotivoTipo] : 'Sin causa'
        doc.text(sistema.toLocaleString('es-ES'), col.sist, y, { align: 'right' })
        doc.text(contado.toLocaleString('es-ES'), col.cont, y, { align: 'right' })
        // Lo que cuadra va en gris y en redonda: está para demostrar que se contó, no
        // para llamar la atención. La negrita se reserva para lo que hay que mirar.
        if (d === 0) {
          gris()
          doc.text('cuadra', col.dif, y, { align: 'right' })
        } else {
          doc.setFont('helvetica', 'bold')
          doc.text(`${d > 0 ? '+' : '-'}${Math.abs(d).toLocaleString('es-ES')}`, col.dif, y, { align: 'right' })
          doc.setFont('helvetica', 'normal')
        }
        doc.text(textoPdfSeguro(causaTxt), col.causa, y)
        tinta()
        y += 5
        // El detalle y el importe, en gris bajo su línea: son el porqué, no el dato. Solo
        // donde hay diferencia — un «0,00 CUP» debajo de cada línea que cuadra es ruido.
        const detalle = d === 0 ? '' : [
          (nota[l.producto_id] ?? l.nota) ? textoPdfSeguro(nota[l.producto_id] ?? l.nota ?? '') : '',
          l.costo != null && moneda ? fmtValor(Math.abs(d) * l.costo, moneda) : '',
        ].filter(Boolean).join(' · ')
        if (detalle) {
          doc.setFontSize(8.5)
          doc.setTextColor(MARCA.faint[0], MARCA.faint[1], MARCA.faint[2])
          doc.text(detalle.slice(0, 110), col.prod + 3, y)
          y += 4.5
        }
        y += 1
      }
    }

    sellarPie(doc, 'Acta de conteo generada con CLAUX')
    doc.save(`acta_conteo_${conteo.conteo_id}.pdf`)
  }

  /**
   * La hoja en blanco, en papel. Es el formato que más sentido tiene de los tres para
   * esto: se imprime, se va con ella al estante y se apunta a boli.
   *
   * **Sin la cantidad del sistema, a propósito** (igual que su Excel): quien cuenta con
   * el número delante no cuenta, confirma — y entonces el conteo no sirve para nada.
   */
  async function hojaPdf() {
    const { crearDoc, cabeceraReporte, sellarPie, MARCA, RESERVA_PIE, textoPdfSeguro } =
      await import('@/lib/pdf/documento')
    const doc   = await crearDoc()
    const pageH = doc.internal.pageSize.getHeight()
    const M = 16, right = doc.internal.pageSize.getWidth() - M
    let y = M

    y = cabeceraReporte(doc, {
      titulo:    'Hoja de conteo',
      izquierda: textoPdfSeguro(almacen),
      derecha:   fmtFechaEs(conteo.fecha),
    })

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.setTextColor(MARCA.muted[0], MARCA.muted[1], MARCA.muted[2])
    doc.text('Contado por: ______________________________', M, y)
    y += 9

    const colCod = M, colProd = M + 26, colUni = right - 62, colCont = right - 34
    const cabecera = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.setTextColor(MARCA.faint[0], MARCA.faint[1], MARCA.faint[2])
      doc.text('CÓDIGO', colCod, y)
      doc.text('PRODUCTO', colProd, y)
      doc.text('UNIDAD', colUni, y)
      doc.text('CONTADO', colCont, y)
      y += 2
      doc.setDrawColor(MARCA.divider[0], MARCA.divider[1], MARCA.divider[2]); doc.setLineWidth(0.3)
      doc.line(M, y, right, y)
      y += 6
    }
    cabecera()

    const orden = [...data.lineas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    for (const l of orden) {
      if (y + 10 > pageH - RESERVA_PIE - 2) { doc.addPage(); y = M; cabecera() }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
      doc.setTextColor(MARCA.faint[0], MARCA.faint[1], MARCA.faint[2])
      doc.text(textoPdfSeguro(l.codigo), colCod, y)
      doc.setTextColor(MARCA.dark[0], MARCA.dark[1], MARCA.dark[2])
      doc.text(textoPdfSeguro(l.nombre).slice(0, 46), colProd, y)
      doc.setTextColor(MARCA.muted[0], MARCA.muted[1], MARCA.muted[2])
      doc.text(textoPdfSeguro(l.unidad || '—'), colUni, y)
      // La casilla donde se escribe: un recuadro, no una raya. Con raya la gente escribe
      // encima y luego no se lee.
      doc.setDrawColor(MARCA.border[0], MARCA.border[1], MARCA.border[2]); doc.setLineWidth(0.3)
      doc.rect(colCont, y - 4, 30, 6.5)
      y += 10
    }

    sellarPie(doc, 'Hoja de conteo generada con CLAUX')
    doc.save(`hoja_conteo_${conteo.almacen_id}.pdf`)
  }

  /**
   * Guardar y salir: el conteo se queda como está, SIN tocar existencias.
   *
   * Aplicar es opcional y siempre lo ha sido —el borrador vive en el servidor y se
   * puede retomar días después—, pero eso no se veía por ninguna parte: la única salida
   * visible era «Aplicar» o el botón de atrás del navegador, que no garantiza que lo
   * último tecleado haya llegado. Aquí se manda lo pendiente, se espera, y se dice.
   */
  function intentarSalir() {
    // Salir con causas pendientes es LEGÍTIMO —un borrador a medias es el caso normal
    // de un conteo que dura días—, así que aquí se avisa y se deja salir. Solo aplicar
    // exige el acta completa.
    if (sinCausa.length > 0) { setAvisoCausas('salir'); return }
    guardarYSalir()
  }

  function guardarYSalir() {
    const ld = toastLoading('Guardando el conteo…')
    startTransition(async () => {
      const ok = await enviarPendientes(true)
      await ld.dismiss()
      if (!ok) { toastError('No se pudo guardar lo último. Revisa la conexión antes de salir.'); return }
      toastSuccess('Conteo guardado. Puedes retomarlo cuando quieras: las existencias no se han tocado.')
      router.push(`/portal/almacenes/${conteo.almacen_id}`)
    })
  }

  /** Quién contó / notas: se apunta y se deja al rebote, como una casilla contada. */
  function tocarCabecera(campo: 'contadoPor' | 'notas', valor: string) {
    if (soloLectura) return
    cab.current = { ...cab.current, [campo]: valor }
    if (campo === 'contadoPor') setContadoPor(valor)
    else                        setNotasActa(valor)
    cabSucia.current = true
    programarRebote()
  }

  // Al salir de la pantalla, lo pendiente se manda: nadie espera perder lo tecleado
  // por haber cerrado antes de que salte el rebote. Es un intento de ÚLTIMA HORA y va
  // en silencio: el navegador puede abortarlo a medias al cambiar de página, y un aviso
  // de error sobre una pantalla que ya no existe no ayuda a nadie.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); mandarAvance(false, true) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [])

  function interpretar() {
    const ld = toastLoading('Interpretando lo que has contado…')
    startTransition(async () => {
      const r = await interpretarConteo(conteo.conteo_id, dictado)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error); return }
      if (r.reconocidos.length === 0) {
        toastError('No he podido emparejar nada con los productos de este almacén.')
        setNoReconocidos(r.noReconocidos)
        return
      }
      // Se rellenan las casillas como si las hubiera teclado el dueño: entran en el
      // mismo camino de guardado (rebote incluido) y se revisan igual.
      const next = { ...vivo.current.texto }
      for (const x of r.reconocidos) {
        next[x.producto_id] = textoNumeroEs(x.cantidad)
        sucias.current.add(x.producto_id)
      }
      vivo.current = { ...vivo.current, texto: next }
      setTexto(next)
      setNoReconocidos(r.noReconocidos)
      toastSuccess(`${r.reconocidos.length} ${r.reconocidos.length === 1 ? 'línea rellenada' : 'líneas rellenadas'}. Revísalas antes de aplicar.`)
      setDictado('')
      mandarAvance()
    })
  }

  /**
   * Carga la hoja rellenada a mano (Excel o CSV) en las casillas.
   *
   * Es la VUELTA de la plantilla. Sin esto, «Hoja para contar» era un callejón sin
   * salida: se imprimía, se contaba con ella en la mano y después había que teclear las
   * 200 cantidades una por una — que es exactamente el hábito («se cuenta en papel y no
   * se carga nunca») que este módulo existe para romper.
   *
   * Lo que vuelve se pinta SIN recargar la pantalla: en Cuba una recarga a media faena
   * es una faena perdida. Y no aplica nada, igual que el dictado: rellena y el dueño
   * revisa, pone causas y aplica cuando quiera.
   */
  function importarArchivo(file: File) {
    const ld = toastLoading('Leyendo el archivo…')
    startTransition(async () => {
      let leido: { contenido: string; formato: 'csv' | 'xlsx' }
      try {
        leido = await leerParaSubir(file)
      } catch (e) {
        await ld.dismiss()
        toastError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
        return
      }

      const r = await importarConteoContado(conteo.conteo_id, leido.contenido, leido.formato)
      await ld.dismiss()
      // Los avisos salen SIEMPRE, haya ido bien o mal: son lo que el archivo trae torcido
      // y es lo que explica por qué faltan líneas.
      for (const a of r.avisos ?? []) toastWarning(a)
      setNoEmparejados(r.sinEmparejar ?? [])
      if (!r.ok || !r.lineas) { toastError(r.error ?? 'No se pudo importar el conteo.'); return }

      // El servidor ya lo guardó, así que estas líneas NO entran en la cola de sucias:
      // volver a mandarlas sería una petición de más sobre la conexión más frágil.
      const next = { ...vivo.current.texto }
      for (const x of r.lineas) next[x.producto_id] = textoNumeroEs(x.contado)
      vivo.current = { ...vivo.current, texto: next }
      setTexto(next)
      setGuardadoEn(ahoraEnTz())
      const n = r.lineas.length
      toastSuccess(`${n} ${n === 1 ? 'línea cargada' : 'líneas cargadas'} del archivo. Revísalas y pon la causa de las diferencias.`)
    })
  }

  function onElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Se limpia el input para que elegir DOS VECES el mismo archivo vuelva a disparar el
    // `change` (si no, el segundo intento no hace nada y parece que la pantalla se cuelga).
    e.target.value = ''
    if (file) importarArchivo(file)
  }

  function intentarAplicar() {
    if (contadas === 0) { toastWarning('Todavía no has contado ninguna línea.'); return }
    // El aviso de causas que faltan aparece AQUÍ, al ir a hacer algo con el conteo, y
    // no como un cartel permanente mientras se cuenta: mientras cuentas es normal que
    // falten causas, y un aviso que sale siempre deja de leerse el segundo día.
    if (sinCausa.length > 0) { setAvisoCausas('aplicar'); return }
    setConfirmar(true)
  }

  function aplicar() {
    const ld = toastLoading('Aplicando el conteo…')
    startTransition(async () => {
      // Lo pendiente primero, AWAIT y comprobando: aplicar sin haber guardado ajustaría
      // con datos viejos, que es exactamente lo que este módulo no puede hacer. Si el
      // guardado no llega, NO se aplica: lo escrito sigue en pantalla y se reintenta.
      // Va en silencio y el aviso lo da esta función, que sabe para qué se guardaba.
      if (!(await enviarPendientes(true))) {
        await ld.dismiss()
        toastError('No se pudo guardar lo último antes de aplicar. Revisa la conexión e inténtalo otra vez.')
        return
      }
      // Aplicar mueve existencias: si la petición se cae a medio camino hay que decirlo
      // con todas las letras, no dejar un overlay de error del navegador.
      let r: Awaited<ReturnType<typeof aplicarConteo>>
      try {
        r = await aplicarConteo(conteo.conteo_id)
      } catch {
        await ld.dismiss()
        toastError('Se perdió la conexión al aplicar. Comprueba en Movimientos si llegó a hacerse antes de repetirlo.')
        return
      }
      await ld.dismiss()
      if (!r.ok) {
        toastError(r.error ?? 'No se pudo aplicar.')
        // El servidor manda: si él ve diferencias sin causa (el TPV pudo dar la vuelta a
        // un faltante mientras se contaba), se enseñan esas líneas y no las mías.
        if (r.sinCausa?.length) { setConfirmar(false); setSoloSinCausa(true) }
        return
      }
      const extra = r.cambiadas
        ? ` · el stock de ${r.cambiadas} ${r.cambiadas === 1 ? 'producto cambió' : 'productos cambió'} mientras contabas`
        : ''
      toastSuccess(
        r.ajustes === 0
          ? 'Todo cuadraba: no hizo falta ajustar nada.'
          : `${r.ajustes} ${r.ajustes === 1 ? 'ajuste aplicado' : 'ajustes aplicados'}${extra}`,
      )
      setConfirmar(false)
      router.push(`/portal/almacenes/${conteo.almacen_id}`)
    })
  }

  return (
    <div className="view-container">
      <div className="breadcrumb">
        <Link href="/portal/almacenes">Almacenes</Link>
        <span>›</span>
        <Link href={`/portal/almacenes/${conteo.almacen_id}`}>{almacen}</Link>
        <span>›</span>
        <span className="breadcrumb-current">Conteo</span>
      </div>

      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">Conteo de {almacen}</h1>
            <span className={`badge ${soloLectura ? 'badge-success' : 'badge-neutral'}`}>
              {soloLectura ? 'Aplicado' : 'Borrador'}
            </span>
          </div>
          <div className="det-meta-row">
            <span>{contadas} de {data.lineas.length} contados</span>
            {difs.size > 0 && <span className="ml-3">{difs.size} con diferencia</span>}
            {!soloLectura && sinCausa.length > 0 && (
              <span className="ml-3 cnt-sin-causa">{sinCausa.length} sin causa</span>
            )}
            {guardadoEn && <span className="ml-3">Guardado a las {guardadoEn}</span>}
          </div>
        </div>
        <div className="det-actions">
          {/* En la cabecera va SOLO el acta, que es el documento de esta pantalla. La
              hoja en blanco no es otra descarga «igual»: es una herramienta para ir a
              contar, y vive abajo con el resto de lo que se usa contando. Dos botones
              «Descargar» juntos son indistinguibles.

              El desplegable dice QUÉ archivo es y nada más: nombra el conteo y el
              formato. Sin frases que expliquen el módulo —al dueño no le interesa la
              mecánica, le interesa qué se lleva— y sin período, que esto no es un listado
              con rango, es UN conteo. Los tres formatos llevan lo MISMO (el almacén
              entero, con lo que falta por contar marcado), así que no hay nada que
              distinguir en letra pequeña. */}
          <ExportarMenu
            sinPeriodo
            clave="acta_conteo"
            filtro={{ conteo_id: conteo.conteo_id }}
            resumen={[`Conteo de ${almacen}`]}
            pdf={{ etiqueta: 'PDF · acta', generar: actaPdf }}
          />
          {!soloLectura && (
            <>
              {/* «Guardar y salir» y no «Guardar avance»: quedarse guarda solo —rebote,
                  al salir del campo, al elegir causa— y eso vale también para los datos
                  del acta, que ya no tienen botón propio. El único botón de guardar que
                  hace falta es el de IRSE sin aplicar.

                  Y es el PRINCIPAL, que es justo lo que la esquina de una cabecera
                  promete: la salida segura. Ahí estaba «Aplicar conteo», que se leía como
                  «terminar lo que estaba haciendo» cuando lo que hace es MOVER
                  EXISTENCIAS y cerrar el acta. Aplicar es el final de la hoja, no la
                  salida de la pantalla: vive al pie, después de las líneas. */}
              <button className="btn btn-primary" onClick={intentarSalir} disabled={pending}>
                <Save size={14} strokeWidth={2} /> Guardar y salir
              </button>
              <button className="btn btn-danger-text" onClick={() => setDescartar(true)} disabled={pending}>
                <Trash2 size={14} strokeWidth={2} /> Descartar
              </button>
            </>
          )}
        </div>
      </div>

      {/* La hoja no es de hoy.
          El borrador no caduca —contar un almacén lleva días y eso es deliberado—, pero
          entonces al mes siguiente «Contar» devuelve ESTA hoja con las cantidades de
          entonces escritas. Si no se dice, parece una hoja nueva y se aplica un conteo
          viejo contra el stock de hoy, que es el error más caro que puede cometer este
          módulo. Con la fecha delante, retomar o empezar de cero es una decisión. */}
      {hojaVieja && (
        <div className="alert alert-warning alert-intro">
          <AlertTriangle size={16} strokeWidth={2} />
          <div className="cnt-aviso-texto">
            <strong>Esta hoja se abrió el {fmtFechaEs(conteo.fecha)}</strong>
            <span>
              Las cantidades que ves son las de ese día. Si vas a hacer un conteo nuevo,
              descarta esta hoja y abre otra desde el almacén: al aplicar, la diferencia se
              calcula contra el stock de ahora mismo.
            </span>
          </div>
        </div>
      )}

      {/* Quién contó y por qué: el acta se firma. Texto libre a propósito — quien
          cuenta con el móvil en la mano rara vez es quien teclea. */}
      <div className="card cnt-acta-datos">
        <div className="grid-cols-2">
          <div className="form-group">
            <label htmlFor="cnt-quien" className="prd-editor-label">Contado por</label>
            {/* Con RRHH contratado se sugiere la plantilla, con el autocompletado del
                portal (`.ac-*`) y NO con un `<datalist>`: el nativo se ve distinto en cada
                navegador y en Android abre un desplegable del sistema. Sigue siendo texto
                libre —quien cuenta puede no estar en nómina—: se sugiere, no se impone. */}
            <AutocompletarTexto
              id="cnt-quien"
              valor={contadoPor}
              opciones={data.personal}
              disabled={soloLectura}
              maxLength={120}
              placeholder="Nombre de quien contó"
              onCambio={v => tocarCabecera('contadoPor', v)}
              onBlur={() => mandarAvance()}
            />
          </div>
          <div className="form-group">
            <label htmlFor="cnt-notas" className="prd-editor-label">Notas del conteo</label>
            <input id="cnt-notas" className="input" type="text" maxLength={300}
              value={notasActa} disabled={soloLectura}
              placeholder="Ej: conteo de fin de mes, nevera incluida"
              onChange={e => tocarCabecera('notas', e.target.value)}
              onBlur={() => mandarAvance()} />
          </div>
        </div>
      </div>

      {/* El resumen del acta, siempre a la vista mientras se cuenta: en unidades y en
          dinero. «Faltan 6 botellas» no mueve a nadie; «faltan 6 = 1.800 CUP» sí. */}
      {difs.size > 0 && (
        <div className="card cnt-resumen">
          <div className="cnt-resumen-cifras">
            <div>
              <span className="text-xs-muted">Faltantes</span>
              <strong className="mov-cant-neg">
                {acta.faltan} {acta.faltan === 1 ? 'producto' : 'productos'}
                {moneda && acta.valorFalta > 0 && ` · ${fmtValor(acta.valorFalta, moneda)}`}
              </strong>
            </div>
            <div>
              <span className="text-xs-muted">Sobrantes</span>
              <strong className="mov-cant-pos">
                {acta.sobran} {acta.sobran === 1 ? 'producto' : 'productos'}
                {moneda && acta.valorSobra > 0 && ` · ${fmtValor(acta.valorSobra, moneda)}`}
              </strong>
            </div>
          </div>
          {acta.sinCoste > 0 && (
            <p className="text-xs-hint">
              {acta.sinCoste === 1
                ? 'Una de las diferencias no tiene coste registrado, así que no se puede valorar.'
                : `${acta.sinCoste} de las diferencias no tienen coste registrado, así que no se pueden valorar.`}
            </p>
          )}
        </div>
      )}

      {!soloLectura && (
        <div className="ter-toolbar cnt-toolbar">
          <label className="ter-archivados-toggle">
            <input type="checkbox" checked={soloPendientes}
              onChange={e => { setSoloPendientes(e.target.checked); if (e.target.checked) setSoloSinCausa(false) }} />
            <span>Solo los que faltan por contar</span>
          </label>
          {(sinCausa.length > 0 || soloSinCausa) && (
            <label className="ter-archivados-toggle">
              <input type="checkbox" checked={soloSinCausa}
                onChange={e => { setSoloSinCausa(e.target.checked); if (e.target.checked) setSoloPendientes(false) }} />
              <span>Solo las diferencias sin causa</span>
            </label>
          )}
          {tieneIa && (
            <button type="button" className="btn btn-ia btn-sm" onClick={() => setDictando(v => !v)}>
              <IaSparkle size={14} /> Dictar el conteo
            </button>
          )}
          {/* La hoja en blanco, en su sitio: junto a lo que se usa MIENTRAS se cuenta.
              Y con su nombre, no otro «Descargar» que no dice qué se lleva. */}
          {/* Sin CSV: esta descarga es una PLANTILLA que se rellena y se vuelve a subir,
              y el CSV abierto en un Excel en español devuelve los acentos rotos y el
              «1.500» convertido en 1,5. En el acta (que se lee, no se rellena) sí está. */}
          <ExportarMenu
            pequeno sinCsv sinPeriodo
            etiquetaBoton="Descargar plantilla"
            clave="hoja_conteo"
            filtro={{ almacen_id: conteo.almacen_id }}
            resumen={[`Plantilla de ${almacen}`]}
            pdf={{ etiqueta: 'PDF · para imprimir', generar: hojaPdf }}
          />
          {/* Y la vuelta de la hoja, PEGADA a ella: se baja, se cuenta a mano y se sube.
              Un botón «Importar» en la otra punta de la pantalla no se relaciona con la
              plantilla que lo necesita. */}
          <input ref={archivoRef} type="file" accept=".csv,.xlsx,text/csv"
            className="cnt-archivo-input" onChange={onElegirArchivo}
            aria-label="Hoja de conteo rellenada (Excel o CSV)" />
          <button type="button" className="btn btn-secondary btn-sm"
            onClick={() => archivoRef.current?.click()} disabled={pending}>
            <Upload size={14} strokeWidth={2} /> Importar conteo
          </button>
        </div>
      )}

      {/* Lo que traía el archivo y no está en esta hoja. Se nombra, no se cuenta: «3 filas
          sin emparejar» no dice qué revisar, «ARZ-001» sí. Casi siempre es la hoja de otro
          almacén, o un código cambiado a mano. */}
      {noEmparejados.length > 0 && (
        <div className="alert alert-warning alert-cta">
          <AlertTriangle size={16} strokeWidth={2} />
          <div className="cnt-aviso-texto">
            <strong>
              {noEmparejados.length === 1
                ? 'Una fila del archivo no está en esta hoja'
                : `${noEmparejados.length} filas del archivo no están en esta hoja`}
            </strong>
            <span>{noEmparejados.slice(0, 12).map(t => `«${t}»`).join(', ')}
              {noEmparejados.length > 12 && ` y ${noEmparejados.length - 12} más`}. Escríbelas
              a mano en su fila, o comprueba que el archivo es el de este almacén.</span>
          </div>
          <button type="button" className="btn btn-aviso btn-sm" onClick={() => setNoEmparejados([])}>
            Entendido
          </button>
        </div>
      )}

      {/* Conteo dictado: el modelo entiende «doce cajas de agua», el CÓDIGO decide a
          qué producto corresponde, y nada se aplica — solo rellena las casillas. */}
      {!soloLectura && dictando && (
        <div className="card cnt-dictado">
          <label htmlFor="cnt-dictado-txt" className="prd-editor-label">
            Escribe o dicta lo que has contado
          </label>
          <textarea id="cnt-dictado-txt" className="input input-textarea" rows={3}
            value={dictado} onChange={e => setDictado(e.target.value)}
            placeholder="Ej: quedan doce cajas de agua, tres de cerveza y medio saco de arroz" />
          <div className="cnt-dictado-acciones">
            <button type="button" className="btn btn-primary btn-sm" onClick={interpretar}
              disabled={pending || !dictado.trim()}>
              {pending ? 'Interpretando…' : 'Rellenar las casillas'}
            </button>
            <span className="text-xs-hint">
              Rellena las casillas para que las revises. No se ajusta nada hasta que apliques el conteo.
            </span>
          </div>
          {noReconocidos.length > 0 && (
            <div className="alert alert-warning">
              No he reconocido {noReconocidos.length === 1 ? 'esto' : 'estos'}:{' '}
              {noReconocidos.map(n => `«${n.texto}» (${n.cantidad})`).join(', ')}. Escríbelo a mano en su fila.
            </div>
          )}
        </div>
      )}

      <div className="card card-table">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="col-num">Contado</th>
                <th className="col-num">Sistema</th>
                <th className="col-num">Diferencia</th>
                <th>Causa</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map(l => {
                const t = (texto[l.producto_id] ?? '')
                const dif = difs.get(l.producto_id) ?? (t.trim() === '' ? null : 0)
                const cz = causa[l.producto_id] ?? ''
                const opciones = dif != null && dif < 0 ? MOTIVOS_FALTANTE : MOTIVOS_SOBRANTE
                return (
                  <tr key={l.producto_id}>
                    <td data-label="Producto">
                      <strong className="cell-clamp">{l.nombre}</strong>
                      <div className="table-cell-secondary">{l.codigo}{l.unidad && ` · ${l.unidad}`}</div>
                    </td>
                    <td data-label="Contado" className="col-num">
                      {soloLectura
                        ? (l.contado != null ? l.contado.toLocaleString('es-ES') : '—')
                        : (
                          <input
                            className="input input-sm cnt-input"
                            type="text" inputMode="decimal"
                            aria-label={`Cantidad contada de ${l.nombre}`}
                            value={t}
                            placeholder="—"
                            onChange={e => tocar(l.producto_id, 'texto', e.target.value)}
                            onBlur={() => mandarAvance()}
                          />
                        )}
                    </td>
                    <td data-label="Sistema" className={`col-num text-sm-muted${l.sistema < 0 ? ' mov-cant-neg' : ''}`}>
                      {(soloLectura && l.contado != null && dif != null
                        ? Math.round((l.contado - dif) * 1000) / 1000
                        : l.sistema).toLocaleString('es-ES')}
                    </td>
                    <td data-label="Diferencia" className={`col-num${dif == null ? '' : dif > 0 ? ' mov-cant-pos' : dif < 0 ? ' mov-cant-neg' : ''}`}>
                      {dif == null ? '—' : dif === 0 ? 'cuadra' : `${dif > 0 ? '+' : '−'}${Math.abs(dif).toLocaleString('es-ES')}`}
                      {dif != null && dif !== 0 && l.costo != null && moneda && (
                        <div className="table-cell-secondary">{fmtValor(Math.abs(dif) * l.costo, moneda)}</div>
                      )}
                    </td>
                    {/* La causa solo se pide donde hay algo que explicar: pedirla en las
                        200 líneas que cuadran sería un formulario que nadie termina. Y
                        la casilla de detalle aparece DESPUÉS de elegir causa — dos
                        campos vacíos a la vez no dicen cuál es el que hay que rellenar. */}
                    <td data-label="Causa">
                      {dif == null || dif === 0 ? (
                        <span className="text-sm-muted">—</span>
                      ) : soloLectura ? (
                        <>
                          <span>{cz ? MOTIVO_LABEL[cz as MotivoTipo] : '—'}</span>
                          {l.nota && <div className="table-cell-secondary">{l.nota}</div>}
                        </>
                      ) : (
                        <div className="cnt-causa">
                          <select
                            className={`input input-sm${cz ? '' : ' cnt-causa-falta'}`}
                            aria-label={`Causa de la diferencia de ${l.nombre}`}
                            value={cz}
                            onChange={e => tocar(l.producto_id, 'causa', e.target.value)}
                          >
                            <option value="">{dif < 0 ? '¿Por qué falta?' : '¿Por qué sobra?'}</option>
                            {opciones.map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
                          </select>
                          {cz && (
                            <input
                              className="input input-sm"
                              type="text" maxLength={300}
                              aria-label={`Detalle de la diferencia de ${l.nombre}`}
                              placeholder="Detalle (opcional)"
                              value={nota[l.producto_id] ?? ''}
                              onChange={e => tocar(l.producto_id, 'nota', e.target.value)}
                              onBlur={() => mandarAvance()}
                            />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {lineas.length === 0 && (
          <div className="mon-empty">
            <p>
              {soloSinCausa   ? 'Todas las diferencias tienen su causa.'
                : soloPendientes ? 'Ya has contado todo.'
                : 'Este almacén no tiene nada que contar.'}
            </p>
          </div>
        )}
      </div>

      {/* El cierre del conteo, AL PIE y no en la cabecera.
          Aplicar no es «guardar y salir de aquí»: es lo que mueve las existencias y
          convierte la hoja en un acta cerrada de solo lectura. Puesto arriba a la derecha
          se leía como el botón de confirmar un formulario, que es el clic reflejo. Aquí
          se llega tras recorrer las líneas, con el recuento delante y diciendo qué va a
          pasar — y sigue siendo la acción principal DE ESTE PASO, porque un conteo que no
          se aplica no arregla nada. */}
      {!soloLectura && (
        <div className="card cnt-cierre">
          <div className="cnt-cierre-texto">
            <strong>
              {contadas === 0
                ? 'Todavía no has contado nada'
                : difs.size === 0
                  ? `${contadas} ${contadas === 1 ? 'línea contada' : 'líneas contadas'}, todo cuadra`
                  : `${contadas} ${contadas === 1 ? 'línea contada' : 'líneas contadas'} · ${difs.size} con diferencia`}
            </strong>
            <span>
              Hasta que apliques el conteo no se ha tocado ninguna existencia. Al aplicarlo
              se ajusta el stock, se guarda un movimiento por cada diferencia con su causa y
              esta hoja queda cerrada como acta de solo lectura.
            </span>
          </div>
          <button className="btn btn-primary" onClick={intentarAplicar} disabled={pending || contadas === 0}>
            <Check size={14} strokeWidth={2} /> Aplicar conteo
          </button>
        </div>
      )}

      {confirmar && (
        <ConfirmDialog
          title="Aplicar el conteo"
          confirmLabel="Aplicar"
          onCancel={() => setConfirmar(false)}
          onConfirm={aplicar}
          body={
            <>
              <p>
                {difs.size === 0
                  ? 'Todo lo contado cuadra con el sistema: no se generará ningún ajuste.'
                  : <>
                      Se ajustarán <strong>{difs.size} productos</strong>: {acta.faltan} con
                      faltante{moneda && acta.valorFalta > 0 && <> ({fmtValor(acta.valorFalta, moneda)})</>} y{' '}
                      {acta.sobran} con sobrante{moneda && acta.valorSobra > 0 && <> ({fmtValor(acta.valorSobra, moneda)})</>}.
                    </>}
              </p>
              {difs.size > 0 && (
                <p className="text-xs-muted mt-2">
                  Cada ajuste queda en el historial con la causa que le has puesto, así que
                  la merma del mes se podrá sumar por separado.
                </p>
              )}
              <p className="text-xs-muted mt-2">
                La diferencia se calcula contra el stock de ahora mismo, no contra el de
                cuando abriste la hoja: si el punto de venta ha vendido mientras contabas,
                se ajusta al valor que has contado.
              </p>
            </>
          }
        />
      )}

      {/* Faltan causas. Sale al ACTUAR (aplicar o salir), no como cartel permanente
          mientras se cuenta — mientras cuentas es normal que falten, y un aviso que sale
          siempre deja de leerse. Dentro va el atajo en lote, que es donde sirve, y SOLO
          el del signo que tiene líneas sin justificar: ofrecer «todos los faltantes»
          cuando no hay ni un faltante es ofrecer un botón que no hace nada. */}
      {avisoCausas && (
        <ConfirmDialog
          title={sinCausa.length === 1 ? 'Falta decir por qué' : `Faltan ${sinCausa.length} causas por poner`}
          cancelLabel="Volver al conteo"
          confirmLabel={avisoCausas === 'aplicar' ? 'Ver las que faltan' : 'Salir de todos modos'}
          onCancel={() => setAvisoCausas(null)}
          onConfirm={() => {
            setAvisoCausas(null)
            if (avisoCausas === 'aplicar') { setSoloPendientes(false); setSoloSinCausa(true) }
            else guardarYSalir()
          }}
          body={
            <>
              <p>
                {avisoCausas === 'aplicar'
                  ? 'No se puede aplicar el conteo hasta que cada diferencia diga por qué. Un ajuste sin motivo no se puede sumar después: dentro de un mes, una caja robada y un error de teclado son la misma línea.'
                  : 'Puedes salir y seguir mañana: el conteo se guarda tal cual. Pero antes de aplicarlo habrá que decir por qué en estas líneas.'}
              </p>
              <ul className="cnt-lista-faltan">
                {sinCausa.slice(0, 6).map(id => {
                  const l = porId.get(id)
                  const d = difs.get(id) ?? 0
                  return (
                    <li key={id}>
                      <strong>{l?.nombre ?? id}</strong>{' '}
                      <span className={d < 0 ? 'mov-cant-neg' : 'mov-cant-pos'}>
                        {d > 0 ? '+' : '−'}{Math.abs(d).toLocaleString('es-ES')}
                      </span>
                    </li>
                  )
                })}
                {sinCausa.length > 6 && <li className="text-sm-muted">y {sinCausa.length - 6} más…</li>}
              </ul>
              {(hayFaltantesSinCausa || haySobrantesSinCausa) && (
                <div className="cnt-lote">
                  <span className="text-xs-muted">Si todas son por lo mismo, ponlo de una vez:</span>
                  {hayFaltantesSinCausa && (
                    <>
                      <label htmlFor="cnt-lote-falta">Los faltantes:</label>
                      <select id="cnt-lote-falta" className="input input-sm" defaultValue=""
                        onChange={e => { causaEnLote('falta', e.target.value); setAvisoCausas(null) }}>
                        <option value="">Elegir causa…</option>
                        {MOTIVOS_FALTANTE.map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
                      </select>
                    </>
                  )}
                  {haySobrantesSinCausa && (
                    <>
                      <label htmlFor="cnt-lote-sobra">Los sobrantes:</label>
                      <select id="cnt-lote-sobra" className="input input-sm" defaultValue=""
                        onChange={e => { causaEnLote('sobra', e.target.value); setAvisoCausas(null) }}>
                        <option value="">Elegir causa…</option>
                        {MOTIVOS_SOBRANTE.map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
                      </select>
                    </>
                  )}
                </div>
              )}
            </>
          }
        />
      )}

      {descartar && (
        <ConfirmDialog
          danger
          title="Descartar el conteo"
          confirmLabel="Descartar"
          onCancel={() => setDescartar(false)}
          onConfirm={() => {
            const ld = toastLoading('Descartando…')
            startTransition(async () => {
              const r = await anularConteo(conteo.conteo_id)
              await ld.dismiss()
              if (!r.ok) { toastError(r.error ?? 'No se pudo descartar.'); return }
              toastSuccess('Conteo descartado')
              router.push(`/portal/almacenes/${conteo.almacen_id}`)
            })
          }}
          body="Se borra lo que has contado. Las existencias no se tocan."
        />
      )}
    </div>
  )
}

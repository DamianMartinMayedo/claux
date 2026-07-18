import type { NextRequest } from 'next/server'
import { obtenerDeckPublico } from '@/app/actions/portal/dossier'
import { lanzarNavegador } from '@/lib/pdf/navegador'

// ── PDF del deck renderizado en servidor — /d/<token>/pdf ─────────────────────
//
// El PDF NO es un documento aparte: es ESTA misma página `/d/<token>` impresa por
// un Chrome que controlamos, no por el del teléfono. Reutiliza el `@media print`
// de `dossier-publica.css` tal cual (misma limpieza: sin degradados ni fondos), y
// el `@page { size: 297mm 167mm }` apaisado que el navegador móvil ignora pero
// Chromium respeta con `preferCSSPageSize`. Resultado: en móvil sale idéntico al
// de escritorio. El teléfono solo descarga el archivo (descargas directas, Cuba).
//
// Node runtime obligatorio: puppeteer no corre en el edge. Cache OFF: el snapshot
// del deck ya está congelado, pero el PDF se genera bajo demanda por descarga.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Ctx {
  params: Promise<{ token: string }>
}

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { token } = await params

  // Valida antes de arrancar Chromium: token inválido / despublicado → 404, sin
  // pagar el arranque del navegador. También da el nombre para el archivo.
  const deck = await obtenerDeckPublico(token)
  if (!deck) return new Response('No encontrado', { status: 404 })

  // El Chrome headless pide la MISMA URL pública del deck a este despliegue.
  const origin = new URL(req.url).origin
  const url = `${origin}/d/${token}`

  const navegador = await lanzarNavegador()
  try {
    const page = await navegador.newPage()
    // Viewport de escritorio: mantiene los breakpoints anchos (relato a dos
    // columnas, equipo a tres) y el mismo lienzo de 1122px para el que están
    // calibrados los clamp()/vw de la hoja. Sin esto reaparece el layout estrecho.
    await page.setViewport({ width: 1122, height: 631 })
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 })

    // Fuentes de marca (entran por <link display=swap>): sin esperarlas, el PDF
    // congela la tipografía del sistema. Y `beforeprint` fija los contadores JS
    // en su cifra final, igual que al imprimir desde el cliente (DeckReveal).
    await page.evaluate(async () => {
      await (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready
      window.dispatchEvent(new Event('beforeprint'))
    })

    const pdf = await page.pdf({
      preferCSSPageSize: true,   // respeta @page { size: 297mm 167mm } apaisado
      printBackground: true,     // el color de fondo ES la marca
    })

    const nombreArchivo = `${deck.nombre} — Dossier.pdf`
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // attachment → descarga directa (no lo abre inline). filename ASCII de
        // reserva + filename* UTF-8 para acentos y el guion largo.
        'Content-Disposition':
          `attachment; filename="${nombreArchivo.replace(/[^\x20-\x7e]/g, '_')}"; ` +
          `filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    // TEMPORAL: superficie el error real para diagnosticar el fallo en Vercel.
    const detalle = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    return new Response(`No se pudo generar el PDF\n\n${detalle}`, { status: 500 })
  } finally {
    await navegador.close()
  }
}

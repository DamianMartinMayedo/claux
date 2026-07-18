// ── Chromium headless para renderizar PDF en servidor ────────────────────────
//
// El deck en móvil NO puede salir del navegador del teléfono: Chrome/Safari de
// móvil ignoran `@page { size }` y meten cabecera/pie propios, así que el PDF sale
// vertical y roto. La solución es renderizar la MISMA página `/d/<token>` con un
// Chrome que controlamos nosotros, a viewport de escritorio, y devolver el archivo
// ya hecho. Así el móvil solo descarga, y el PDF es idéntico al de escritorio:
// mismo HTML, mismo `@media print`, misma limpieza (sin degradados ni fondos).
//
// En Vercel usa el Chromium empaquetado por `@sparticuz/chromium` (binario para el
// runtime serverless). En local, el Chrome del sistema — no hace falta descargar
// nada. El ejecutable local se puede sobreescribir con CHROME_EXECUTABLE_PATH.

import type { Browser } from 'puppeteer-core'

const CHROME_LOCAL_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function lanzarNavegador(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default

  // En Vercel (o cualquier build de producción) → Chromium serverless.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  // Local: Chrome ya instalado en la máquina.
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || CHROME_LOCAL_MAC
  return puppeteer.launch({ executablePath, headless: true })
}
